import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient } from '../_shared/auth.ts';
import { hashLicenseKey, normalizeKey } from '../_shared/license.ts';
import { effectiveStatus, type LicenseRow } from '../_shared/licenses.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const body = await readJson(req);
  const key = normalizeKey(body.key);
  if (!key) return json(req, 400, { valid: false, error: 'invalid_key_format' });

  const admin = adminClient();
  const { data: row } = await admin
    .from('licenses')
    .select('plan, status, expires_at, max_seats')
    .eq('key_hash', await hashLicenseKey(key))
    .maybeSingle();

  if (!row) return json(req, 404, { valid: false, error: 'invalid_key' });

  const license = row as LicenseRow;
  const status = effectiveStatus(license);
  const usable = status === 'active' || status === 'past_due';
  return json(req, 200, {
    valid: usable,
    plan: license.plan,
    status,
    maxSeats: license.max_seats,
    expiresAt: license.expires_at
  });
});
