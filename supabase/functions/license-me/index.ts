import { json, preflight } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { effectiveStatus, toPublicLicense, type LicenseRow } from '../_shared/licenses.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(req, 405, { error: 'method_not_allowed' });
  }

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const admin = adminClient();
  const { data: row, error } = await admin
    .from('licenses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return json(req, 500, { error: 'license_lookup_failed' });
  if (!row) {
    return json(req, 200, { license: null, serverTime: new Date().toISOString() });
  }

  const license = row as LicenseRow;
  const status = effectiveStatus(license);
  if (status !== license.status) {
    await admin.from('licenses').update({ status }).eq('id', license.id);
    license.status = status;
  }

  const { data: activations } = await admin
    .from('license_activations')
    .select('id, device_id, device_label, platform, app_version, created_at, last_seen_at')
    .eq('license_id', license.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: true });

  return json(req, 200, {
    license: await toPublicLicense(license, activations ?? []),
    serverTime: new Date().toISOString()
  });
});
