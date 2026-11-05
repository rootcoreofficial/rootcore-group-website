import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { hashDeviceId } from '../_shared/license.ts';
import { validDeviceId } from '../_shared/licenses.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const body = await readJson(req);
  const activationId = String(body.activationId ?? body.activation_id ?? '').trim();

  const admin = adminClient();
  const { data: row } = await admin
    .from('licenses')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!row) return json(req, 404, { error: 'no_license' });

  let deviceHash: string | null = null;

  if (activationId) {
    if (!UUID_RE.test(activationId)) return json(req, 400, { error: 'invalid_activation' });
    const { data: act } = await admin
      .from('license_activations')
      .select('device_id')
      .eq('id', activationId)
      .eq('license_id', row.id)
      .is('revoked_at', null)
      .maybeSingle();
    if (!act) return json(req, 404, { error: 'activation_not_found' });
    deviceHash = String(act.device_id);
  } else {
    const rawDevice = validDeviceId(body.deviceId ?? body.device_id);
    if (!rawDevice) return json(req, 400, { error: 'invalid_device' });
    deviceHash = await hashDeviceId(rawDevice);
  }

  const { data: ok, error } = await admin.rpc('license_detach_device', {
    p_license_id: row.id,
    p_user_id: user.id,
    p_device_id: deviceHash
  });

  if (error) return json(req, 500, { error: 'deactivation_failed' });
  return json(req, 200, { ok: Boolean(ok) });
});
