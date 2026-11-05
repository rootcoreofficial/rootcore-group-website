import { json } from '../_shared/http.ts';
import { adminClient } from '../_shared/auth.ts';
import { verifyStripeSignature, stripeRequest, subscriptionPlan, StripeError } from '../_shared/stripe.ts';
import { applySubscription, customerIdOf, markSubscription, type SubscriptionLike } from '../_shared/provision.ts';

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid'
]);

async function userIdFor(admin: ReturnType<typeof adminClient>, subscription: SubscriptionLike): Promise<string | null> {
  const meta = subscription.metadata?.user_id;
  if (meta) return meta;

  const { data: bySub } = await admin
    .from('licenses')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();
  if (bySub?.user_id) return bySub.user_id;

  const customer = customerIdOf(subscription.customer);
  if (customer) {
    const { data: byCustomer } = await admin
      .from('licenses')
      .select('user_id')
      .eq('stripe_customer_id', customer)
      .maybeSingle();
    if (byCustomer?.user_id) return byCustomer.user_id;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json(req, 503, { error: 'webhook_unconfigured' });

  const raw = await req.text();
  const valid = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret);
  if (!valid) return json(req, 400, { error: 'invalid_signature' });

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch (_) {
    return json(req, 400, { error: 'invalid_json' });
  }
  if (!HANDLED.has(event?.type)) return json(req, 200, { ok: true, ignored: true });

  const admin = adminClient();

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.user_id;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (userId && subscriptionId) {
        const subscription = await stripeRequest(`/subscriptions/${subscriptionId}`);
        const planHint = session.metadata?.plan === 'annual' ? 'annual' : 'monthly';
        await applySubscription(admin, userId, subscription, planHint);
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as SubscriptionLike;
      const userId = await userIdFor(admin, subscription);
      if (userId) {
        await applySubscription(admin, userId, subscription, subscriptionPlan(subscription));
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as SubscriptionLike;
      await markSubscription(
        admin,
        subscription.id,
        { status: 'expired', expires_at: new Date().toISOString(), cancel_at_period_end: true },
        'stripe_deleted'
      );
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        await markSubscription(admin, subscriptionId, { status: 'past_due' }, 'stripe_payment_failed');
      }
    } else if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        const subscription = await stripeRequest(`/subscriptions/${subscriptionId}`);
        const userId = await userIdFor(admin, subscription);
        if (userId) await applySubscription(admin, userId, subscription, subscriptionPlan(subscription));
      }
    }
    return json(req, 200, { ok: true });
  } catch (error) {
    if (error instanceof StripeError) {
      return json(req, 502, { error: 'stripe_error' });
    }
    return json(req, 500, { error: 'webhook_failed' });
  }
});
