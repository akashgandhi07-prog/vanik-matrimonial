import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { applyRenewalPayment, renewalSessionFromStripe } from '../_shared/renewal.ts';
import { stripeRetrieveCheckoutSession } from '../_shared/stripe.ts';

/**
 * Called by /renew-membership when Stripe redirects the member back after paying.
 * Checks the session with Stripe and applies the renewal there and then, so a
 * renewal never depends on the webhook arriving (it is the same check
 * submit-registration does for new members).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!secret) {
    return jsonResponse({ error: 'Stripe is not configured on the server.' }, req, 503);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  let body: { session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!/^cs_[A-Za-z0-9_]{1,250}$/.test(sessionId)) {
    return jsonResponse({ error: 'Invalid checkout session' }, req, 400);
  }

  let raw: Record<string, unknown>;
  try {
    raw = await stripeRetrieveCheckoutSession(secret, sessionId);
  } catch (e) {
    console.error('confirm-renewal: Stripe lookup failed', e);
    return jsonResponse({ error: 'Could not check the payment with Stripe. Please try again shortly.' }, req, 502);
  }

  const session = renewalSessionFromStripe(raw);
  // Only the member who opened the checkout can confirm it.
  if (session.metadata.supabase_user_id !== userData.user.id || session.metadata.purpose !== 'renewal') {
    return jsonResponse({ error: 'This payment does not belong to your account.' }, req, 403);
  }

  const outcome = await applyRenewalPayment(getAdminClient(), session);
  if (outcome.status === 'error') {
    return jsonResponse({ error: 'Your payment was received but we could not update your membership. Please email matrimonial@vanikcouncil.uk and we will sort it out.' }, req, 500);
  }
  return jsonResponse(outcome, req);
});
