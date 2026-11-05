import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { encryptLicenseKey, generateLicenseKey, hashLicenseKey, keyHint } from './license.ts';
import { subscriptionPlan, subscriptionPriceId } from './stripe.ts';

export interface SubscriptionLike {
  id: string;
  customer?: string | { id: string } | null;
  status?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ price?: { id?: string } }> };
}

export function customerIdOf(value: SubscriptionLike['customer']): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id ?? null;
}

export function mapSubscriptionStatus(status: string | undefined): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
      return 'pending';
    case 'unpaid':
    case 'incomplete_expired':
      return 'expired';
    case 'paused':
      return 'past_due';
    default:
      return 'active';
  }
}

function periodEnd(subscription: SubscriptionLike): string | null {
  return subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
}

interface KeyMaterial {
  key: string;
  hash: string;
  hint: string;
  ciphertext: string;
}

async function newKeyMaterial(): Promise<KeyMaterial> {
  const key = generateLicenseKey();
  return {
    key,
    hash: await hashLicenseKey(key),
    hint: keyHint(key),
    ciphertext: await encryptLicenseKey(key)
  };
}

export async function applySubscription(
  admin: SupabaseClient,
  userId: string,
  subscription: SubscriptionLike,
  planHint?: 'monthly' | 'annual' | null
): Promise<void> {
  const { data: existing } = await admin
    .from('licenses')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.plan === 'lifetime' && existing?.status === 'active') {
    await admin.from('license_events').insert({
      license_id: existing.id,
      event_type: 'stripe_ignored_lifetime',
      detail: { subscription_id: subscription.id }
    });
    return;
  }

  const plan = planHint ?? subscriptionPlan(subscription) ?? existing?.plan ?? 'monthly';
  const status = mapSubscriptionStatus(subscription.status);
  const expiresAt = periodEnd(subscription);
  const priceId = subscriptionPriceId(subscription);
  const customerId = customerIdOf(subscription.customer);

  if (existing) {
    const patch: Record<string, unknown> = {
      plan,
      status,
      expires_at: plan === 'lifetime' ? null : expiresAt,
      stripe_customer_id: customerId ?? existing.stripe_customer_id,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      current_period_end: expiresAt,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      source: existing.source === 'lifetime' ? 'stripe' : existing.source,
      last_seen_at: new Date().toISOString()
    };
    if (!existing.key_hash) {
      const material = await newKeyMaterial();
      patch.key_hash = material.hash;
      patch.key_hint = material.hint;
      patch.key_ciphertext = material.ciphertext;
    }
    await admin.from('licenses').update(patch).eq('id', existing.id);
    await admin.from('license_events').insert({
      license_id: existing.id,
      event_type: 'stripe_sync',
      detail: { subscription_id: subscription.id, status, plan }
    });
    return;
  }

  const material = await newKeyMaterial();
  const { data: inserted, error } = await admin.from('licenses').insert({
    user_id: userId,
    plan,
    status,
    source: 'stripe',
    key_hash: material.hash,
    key_hint: material.hint,
    key_ciphertext: material.ciphertext,
    max_seats: 2,
    expires_at: expiresAt,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    current_period_end: expiresAt,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
  }).select('id').single();

  if (error) {
    // Corsa con un altro webhook: rileggi e aggiorna invece di duplicare.
    const { data: raced } = await admin
      .from('licenses')
      .select('id, key_hash')
      .eq('user_id', userId)
      .maybeSingle();
    if (raced) {
      const patch: Record<string, unknown> = {
        plan,
        status,
        expires_at: expiresAt,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        current_period_end: expiresAt,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
      };
      if (!raced.key_hash) {
        patch.key_hash = material.hash;
        patch.key_hint = material.hint;
        patch.key_ciphertext = material.ciphertext;
      }
      await admin.from('licenses').update(patch).eq('id', raced.id);
    }
    return;
  }

  if (inserted?.id) {
    await admin.from('license_events').insert({
      license_id: inserted.id,
      event_type: 'license_issued',
      detail: { plan, source: 'stripe', subscription_id: subscription.id }
    });
  }
}

export async function markSubscription(
  admin: SupabaseClient,
  subscriptionId: string,
  patch: Record<string, unknown>,
  eventType: string
): Promise<void> {
  const { data: row } = await admin
    .from('licenses')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (!row) return;
  await admin.from('licenses').update(patch).eq('id', row.id);
  await admin.from('license_events').insert({
    license_id: row.id,
    event_type: eventType,
    detail: { subscription_id: subscriptionId, ...patch }
  });
}
