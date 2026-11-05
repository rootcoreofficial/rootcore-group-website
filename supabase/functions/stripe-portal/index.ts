import { json, preflight } from '../_shared/http.ts';
import { adminClient, authUser } from '../_shared/auth.ts';
import { siteUrl, StripeError, stripeRequest } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const user = await authUser(req);
  if (!user) return json(req, 401, { error: 'unauthorized' });

  const admin = adminClient();
  const { data: license } = await admin
    .from('licenses')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!license?.stripe_customer_id) {
    return json(req, 404, { error: 'no_billing_account' });
  }

  const form = new URLSearchParams();
  form.set('customer', license.stripe_customer_id);
  form.set('return_url', `${siteUrl()}/perry/account/`);

  try {
    const session = await stripeRequest('/billing_portal/sessions', { method: 'POST', form });
    return json(req, 200, { url: session.url });
  } catch (error) {
    if (error instanceof StripeError) {
      return json(req, 502, { error: 'stripe_error', message: 'Gestione abbonamento non disponibile. Riprova tra poco.' });
    }
    return json(req, 500, { error: 'portal_failed' });
  }
});
