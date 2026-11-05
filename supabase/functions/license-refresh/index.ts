import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { hashDeviceId, issueLease } from '../_shared/license.ts';
import { effectiveStatus, type LicenseRow, validDeviceId } from '../_shared/licenses.ts';

const REFRESHABLE = new Set(['active', 'past_due', 'canceled']);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const body = await readJson(req);
  const rawDevice = validDeviceId(body.deviceId ?? body.device_id);
  if (!rawDevice) return json(req, 400, { error: 'invalid_device' });

  const admin = adminClient();
  const { data: row, error } = await admin
    .from('licenses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return json(req, 500, { error: 'license_lookup_failed' });
  if (!row) return json(req, 404, { error: 'no_license' });

  const license = row as LicenseRow;
  const status = effectiveStatus(license);
  if (status !== license.status) {
    await admin.from('licenses').update({ status }).eq('id', license.id);
    license.status = status;
  }
  if (!REFRESHABLE.has(status)) {
    return json(req, 403, { error: 'license_inactive', status });
  }

  const deviceHash = await hashDeviceId(rawDevice);
  const { data: activation } = await admin
    .from('license_activations')
    .select('id, revoked_at')
    .eq('license_id', license.id)
    .eq('device_id', deviceHash)
    .maybeSingle();

  if (!activation || activation.revoked_at) {
    return json(req, 403, { error: 'device_not_activated' });
  }

  await admin.from('license_activations').update({ last_seen_at: new Date().toISOString() }).eq('id', activation.id);
  await admin.from('licenses').update({ last_seen_at: new Date().toISOString() }).eq('id', license.id);

  const lease = await issueLease({
    licenseId: license.id,
    userId: user.id,
    plan: license.plan,
    deviceId: deviceHash,
    seats: license.max_seats
  });

  return json(req, 200, {
    ok: true,
    license: {
      plan: license.plan,
      status,
      maxSeats: license.max_seats,
      issuedAt: license.issued_at,
      expiresAt: license.expires_at,
      cancelAtPeriodEnd: license.cancel_at_period_end
    },
    lease
  });
});
