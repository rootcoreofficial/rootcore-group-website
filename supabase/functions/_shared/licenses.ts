import { decryptLicenseKey } from './license.ts';

export interface LicenseRow {
  id: string;
  user_id: string | null;
  plan: 'monthly' | 'annual' | 'lifetime';
  status: 'active' | 'past_due' | 'canceled' | 'expired' | 'revoked' | 'pending';
  source: string;
  key_hint: string;
  key_ciphertext: string | null;
  max_seats: number;
  issued_at: string;
  claimed_at: string | null;
  expires_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
}

export function effectiveStatus(row: LicenseRow): LicenseRow['status'] {
  if (row.status === 'active' || row.status === 'past_due' || row.status === 'canceled') {
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  }
  return row.status;
}

export function planLabel(plan: string): string {
  if (plan === 'monthly') return 'Mensile';
  if (plan === 'annual') return 'Annuale';
  if (plan === 'lifetime') return 'Lifetime';
  return plan;
}

export interface PublicLicense {
  plan: string;
  planLabel: string;
  status: string;
  key: string | null;
  hint: string;
  maxSeats: number;
  seatsUsed: number;
  issuedAt: string;
  expiresAt: string | null;
  cancelAtPeriodEnd: boolean;
  source: string;
  activations: Array<{
    id: string;
    deviceId: string;
    label: string | null;
    platform: string | null;
    appVersion: string | null;
    createdAt: string;
    lastSeenAt: string;
  }>;
}

export async function toPublicLicense(
  row: LicenseRow,
  activations: Array<Record<string, unknown>> = [],
  opts: { revealKey?: boolean } = {}
): Promise<PublicLicense> {
  const key = opts.revealKey === false ? null : await decryptLicenseKey(row.key_ciphertext);
  return {
    plan: row.plan,
    planLabel: planLabel(row.plan),
    status: effectiveStatus(row),
    key,
    hint: row.key_hint,
    maxSeats: row.max_seats,
    seatsUsed: activations.length,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    source: row.source,
    activations: activations.map((a) => ({
      id: String(a.id ?? ''),
      deviceId: String(a.device_id ?? ''),
      label: (a.device_label as string) ?? null,
      platform: (a.platform as string) ?? null,
      appVersion: (a.app_version as string) ?? null,
      createdAt: String(a.created_at ?? ''),
      lastSeenAt: String(a.last_seen_at ?? '')
    }))
  };
}

export function deviceLabelFrom(value: unknown): string | null {
  const label = String(value ?? '').trim();
  if (!label) return null;
  return label.slice(0, 60);
}

export function validDeviceId(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!/^[a-f0-9]{48,128}$/i.test(raw)) return null;
  return raw.toLowerCase();
}
