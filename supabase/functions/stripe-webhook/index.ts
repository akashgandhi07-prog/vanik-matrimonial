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
    // Deno only has async WebCrypto: the synchronous constructEvent always throws here,
    // which is why every delivery was rejected and Stripe disabled the endpoint.
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      whSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('stripe-webhook signature check failed:', msg);
    return jsonResponse({ error: `Webhook signature: ${msg}` }, req, 400);
  }

  if (event.type === 'charge.refunded') {
    return await recordRefund(stripe, event.data.object as Stripe.Charge, req);
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

/**
 * Mirrors a refund into stripe_checkout_sessions so admin > Payments shows it, whether it
 * was issued from admin > Payments or straight from the Stripe Dashboard. Registration
 * rows do not store the payment intent, so the session is found through Stripe.
 */
async function recordRefund(stripe: Stripe, charge: Stripe.Charge, req: Request): Promise<Response> {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return jsonResponse({ received: true, skipped: 'no_payment_intent' }, req);

  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const sessionId = sessions.data[0]?.id;
  if (!sessionId) return jsonResponse({ received: true, skipped: 'no_checkout_session' }, req);

  const admin = getAdminClient();
  const { data: row } = await admin
    .from('stripe_checkout_sessions')
    .select('refund_id, refund_amount, refunded_at')
    .eq('checkout_session_id', sessionId)
    .maybeSingle();
  if (!row) return jsonResponse({ received: true, skipped: 'session_not_recorded' }, req);

  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from('stripe_checkout_sessions')
    .update({
      // Keep the id written by admin > Payments if it got there first.
      refund_id: (row.refund_id as string | null) ?? refunds.data[0]?.id ?? 'stripe-dashboard',
      refund_amount: charge.amount_refunded,
      refunded_at: (row.refunded_at as string | null) ?? nowIso,
      payment_intent_id: paymentIntentId,
      updated_at: nowIso,
    })
    .eq('checkout_session_id', sessionId);
  if (error) {
    console.error('stripe-webhook refund sync', error);
    return jsonResponse({ error: error.message }, req, 500);
  }
  return jsonResponse({ received: true, refund_recorded: true }, req);
}
