import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { siteUrl, stripeConfigured, StripeError, stripeRequest } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const body = await readJson(req);
  const plan = body.plan === 'monthly' ? 'monthly' : body.plan === 'annual' ? 'annual' : null;
  if (!plan) return json(req, 400, { error: 'invalid_plan' });

  if (!stripeConfigured()) {
    return json(req, 503, {
      error: 'payments_unavailable',
      message: 'Pagamenti in attivazione. Scrivici per attivare il piano.'
    });
  }

  const priceId = plan === 'monthly'
    ? Deno.env.get('STRIPE_PRICE_MONTHLY')!
    : Deno.env.get('STRIPE_PRICE_ANNUAL')!;

  const admin = adminClient();
  const { data: existing } = await admin
    .from('licenses')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${siteUrl()}/perry/account/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${siteUrl()}/perry/account/?checkout=cancel`);
  form.set('client_reference_id', user.id);
  form.set('metadata[user_id]', user.id);
  form.set('metadata[plan]', plan);
  form.set('subscription_data[metadata][user_id]', user.id);
  form.set('subscription_data[metadata][plan]', plan);
  form.set('allow_promotion_codes', 'true');

  if (existing?.stripe_customer_id) {
    form.set('customer', existing.stripe_customer_id);
  } else if (user.email) {
    form.set('customer_email', user.email);
  }

  try {
    const session = await stripeRequest('/checkout/sessions', { method: 'POST', form });
    return json(req, 200, { url: session.url, id: session.id });
  } catch (error) {
    if (error instanceof StripeError) {
      return json(req, 502, { error: 'stripe_error', message: 'Pagamento non disponibile in questo momento. Riprova tra poco.' });
    }
    return json(req, 500, { error: 'checkout_failed' });
  }
});
