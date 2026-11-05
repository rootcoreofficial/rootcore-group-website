import { requireEnv } from './http.ts';

const API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function stripeRequest(
  path: string,
  options: { method?: string; form?: URLSearchParams } = {}
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${requireEnv('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: options.form?.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new StripeError(data?.error?.message ?? 'stripe_error', res.status, data?.error?.code ?? null);
  }
  return data;
}

export function siteUrl(): string {
  return (Deno.env.get('SITE_URL') ?? 'https://www.rootcoregroup.com').replace(/\/+$/, '');
}

export function planFromPrice(priceId: string | null | undefined): 'monthly' | 'annual' | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get('STRIPE_PRICE_MONTHLY')) return 'monthly';
  if (priceId === Deno.env.get('STRIPE_PRICE_ANNUAL')) return 'annual';
  return null;
}

export function stripeConfigured(): boolean {
  return Boolean(
    Deno.env.get('STRIPE_SECRET_KEY') &&
    Deno.env.get('STRIPE_PRICE_MONTHLY') &&
    Deno.env.get('STRIPE_PRICE_ANNUAL')
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > 0) acc[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    return acc;
  }, {} as Record<string, string>);

  const timestamp = Number(parts.t);
  if (!timestamp || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, parts.v1.toLowerCase());
}

export function subscriptionPriceId(subscription: any): string | null {
  return subscription?.items?.data?.[0]?.price?.id ?? null;
}

export function subscriptionPlan(subscription: any): 'monthly' | 'annual' | null {
  const fromMeta = subscription?.metadata?.plan;
  if (fromMeta === 'monthly' || fromMeta === 'annual') return fromMeta;
  return planFromPrice(subscriptionPriceId(subscription));
}
