import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { applyRenewalPayment, renewalSessionFromStripe } from '../_shared/renewal.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')?.trim();
  if (!secret || !whSecret) {
    return jsonResponse({ error: 'Stripe webhook not configured' }, req, 503);
  }

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return jsonResponse({ error: 'Missing stripe-signature' }, req, 400);
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, whSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: `Webhook signature: ${msg}` }, req, 400);
  }

  if (event.type !== 'checkout.session.completed') {
    return jsonResponse({ received: true }, req);
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') {
    return jsonResponse({ received: true, skipped: 'not_paid' }, req);
  }

  const meta = session.metadata ?? {};
  const purpose = meta.purpose;
  const authUserId = meta.supabase_user_id;
  const checkoutSessionId = session.id;
  const amountTotal = session.amount_total ?? null;
  const currency = session.currency ?? null;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;

  if (!checkoutSessionId || typeof authUserId !== 'string') {
    return jsonResponse({ received: true, skipped: 'bad_metadata' }, req);
  }

  const admin = getAdminClient();

  if (purpose === 'registration') {
    const row = {
      checkout_session_id: checkoutSessionId,
      auth_user_id: authUserId,
      profile_id: null as string | null,
      purpose: 'registration' as const,
      payment_status: 'paid',
      amount_total: amountTotal,
      currency,
      payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('stripe_checkout_sessions').insert(row);
    if (error?.code === '23505') {
      // The row already exists, almost always because submit-registration created
      // it first - it is the only writer that knows consumed_at, and the member
      // submits within seconds of paying. It records the payment but not the
      // amount, so a duplicate key is not "nothing left to do": fill in what only
      // Stripe knows. Guarded on amount_total being null so retries are no-ops and
      // a good value is never overwritten.
      const { error: backfillErr } = await admin
        .from('stripe_checkout_sessions')
        .update({
          amount_total: amountTotal,
          currency,
          payment_intent_id: paymentIntentId,
          updated_at: new Date().toISOString(),
        })
        .eq('checkout_session_id', checkoutSessionId)
        .is('amount_total', null);
      if (backfillErr) {
        console.error('stripe_checkout_sessions backfill registration', backfillErr);
      }
      return jsonResponse({ received: true, idempotent: true }, req);
    }
    if (error) {
      console.error('stripe_checkout_sessions insert registration', error);
      return jsonResponse({ error: error.message }, req, 500);
    }
    return jsonResponse({ received: true }, req);
  }

  if (purpose === 'renewal') {
    const outcome = await applyRenewalPayment(
      admin,
      renewalSessionFromStripe(session as unknown as Record<string, unknown>),
    );
    if (outcome.status === 'error') {
      return jsonResponse({ error: outcome.message }, req, 500);
    }
    if (outcome.status === 'renewed') {
      return jsonResponse({ received: true, renewed: true, bonus_months: outcome.bonus_months }, req);
    }
    if (outcome.status === 'skipped') {
      return jsonResponse({ received: true, skipped: outcome.reason }, req);
    }
    return jsonResponse({ received: true, [outcome.status === 'duplicate' ? 'duplicate' : 'idempotent']: true }, req);
  }

  return jsonResponse({ received: true, skipped: 'unknown_purpose' }, req);
});
