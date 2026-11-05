const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = 5;
const GROUPS = 4;
const AAD = new TextEncoder().encode('perry-license-v1');

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromB64(value: string): Uint8Array {
  return b64urlDecode(value);
}

export function normalizeKey(input: unknown): string | null {
  let raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.startsWith('PERRY')) raw = raw.slice(5);
  raw = raw.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (raw.length !== GROUP * GROUPS) return null;
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(raw)) return null;
  const parts: string[] = [];
  for (let i = 0; i < GROUPS; i++) parts.push(raw.slice(i * GROUP, (i + 1) * GROUP));
  return `PERRY-${parts.join('-')}`;
}

export function keyHint(key: string): string {
  const body = key.replace(/^PERRY-/, '');
  return `PERRY-${body.slice(0, GROUP)}-…-${body.slice(-GROUP)}`;
}

export async function hashLicenseKey(key: string): Promise<string> {
  const pepper = fromB64(requireSecret('LICENSE_HMAC_PEPPER'));
  const cryptoKey = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(key));
  return toHex(new Uint8Array(sig));
}

export async function hashDeviceId(raw: string): Promise<string> {
  const pepper = fromB64(requireSecret('LICENSE_HMAC_PEPPER'));
  const cryptoKey = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`device:${raw}`));
  return toHex(new Uint8Array(sig));
}

async function aesKey(): Promise<CryptoKey> {
  const master = fromB64(requireSecret('LICENSE_AES_KEY'));
  if (master.length !== 32) throw new Error('bad_aes_key');
  return crypto.subtle.importKey('raw', master, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptLicenseKey(key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    await aesKey(),
    new TextEncoder().encode(key)
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptLicenseKey(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  const [version, ivPart, ctPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !ctPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivPart), additionalData: AAD },
      await aesKey(),
      fromB64(ctPart)
    );
    return new TextDecoder().decode(plain);
  } catch (_) {
    return null;
  }
}

export function generateLicenseKey(): string {
  const chars: string[] = [];
  const buf = new Uint8Array(64);
  while (chars.length < GROUP * GROUPS) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= 224) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]);
      if (chars.length === GROUP * GROUPS) break;
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < GROUPS; i++) parts.push(chars.slice(i * GROUP, (i + 1) * GROUP).join(''));
  return `PERRY-${parts.join('-')}`;
}

let signingKeyPromise: Promise<CryptoKey> | null = null;

async function signingKey(): Promise<CryptoKey> {
  if (!signingKeyPromise) {
    const der = fromB64(requireSecret('LICENSE_SIGNING_KEY'));
    signingKeyPromise = crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  }
  return signingKeyPromise;
}

const LEASE_SECONDS = 30 * 24 * 60 * 60;

export interface LeaseInput {
  licenseId: string;
  userId: string;
  plan: string;
  deviceId: string;
  seats: number;
}

export async function issueLease(input: LeaseInput): Promise<{ payload: string; sig: string; expires_at: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + LEASE_SECONDS;
  const payload = {
    v: 1,
    lid: input.licenseId,
    uid: input.userId,
    plan: input.plan,
    did: input.deviceId,
    seats: input.seats,
    iat: now,
    exp,
    jti: toHex(crypto.getRandomValues(new Uint8Array(12)))
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, await signingKey(), bytes);
  return {
    payload: b64urlEncode(bytes),
    sig: b64urlEncode(new Uint8Array(sig)),
    expires_at: new Date(exp * 1000).toISOString()
  };
}

function requireSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}
