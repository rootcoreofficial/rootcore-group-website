import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { hashDeviceId, hashLicenseKey, issueLease, normalizeKey } from '../_shared/license.ts';
import { deviceLabelFrom, effectiveStatus, type LicenseRow, validDeviceId } from '../_shared/licenses.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const body = await readJson(req);
  const key = normalizeKey(body.key);
  const rawDevice = validDeviceId(body.deviceId ?? body.device_id);
  if (!key) return json(req, 400, { error: 'invalid_key_format' });
  if (!rawDevice) return json(req, 400, { error: 'invalid_device' });

  const admin = adminClient();
  const keyHash = await hashLicenseKey(key);
  const { data: row, error } = await admin
    .from('licenses')
    .select('*')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) return json(req, 500, { error: 'license_lookup_failed' });
  if (!row) return json(req, 404, { error: 'invalid_key' });

  const license = row as LicenseRow;
  if (effectiveStatus(license) === 'expired' && license.status !== 'expired') {
    await admin.from('licenses').update({ status: 'expired' }).eq('id', license.id);
    license.status = 'expired';
  }

  const deviceHash = await hashDeviceId(rawDevice);
  const platform = String(body.platform ?? 'win32').slice(0, 32);
  const appVersion = String(body.appVersion ?? body.app_version ?? '').slice(0, 32) || null;

  const { data: result, error: rpcError } = await admin.rpc('license_attach_device', {
    p_license_id: license.id,
    p_user_id: user.id,
    p_device_id: deviceHash,
    p_device_label: deviceLabelFrom(body.deviceLabel ?? body.device_label),
    p_platform: platform,
    p_app_version: appVersion
  });

  if (rpcError) return json(req, 500, { error: 'activation_failed' });
  if (result?.error) {
    const map: Record<string, number> = {
      not_found: 404,
      forbidden: 403,
      inactive: 403,
      seats_exceeded: 409,
      not_claimable: 409,
      already_licensed: 409,
      bad_request: 400
    };
    return json(req, map[result.error] ?? 400, {
      error: result.error,
      maxSeats: result.max_seats ?? null
    });
  }

  const attached = result.license as {
    id: string;
    user_id: string;
    plan: string;
    status: string;
    max_seats: number;
    issued_at: string;
    expires_at: string | null;
  };

  const lease = await issueLease({
    licenseId: attached.id,
    userId: attached.user_id,
    plan: attached.plan,
    deviceId: deviceHash,
    seats: attached.max_seats
  });

  await admin.from('licenses').update({ last_seen_at: new Date().toISOString() }).eq('id', attached.id);

  return json(req, 200, {
    ok: true,
    license: {
      plan: attached.plan,
      status: attached.status,
      maxSeats: attached.max_seats,
      issuedAt: attached.issued_at,
      expiresAt: attached.expires_at
    },
    lease
  });
});
