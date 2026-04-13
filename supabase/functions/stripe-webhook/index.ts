import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

function addOneYear(from: Date): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')?.trim();
  if (!secret || !whSecret) {
    return jsonResponse({ error: 'Stripe webhook not configured' }, 503);
  }

  const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return jsonResponse({ error: 'Missing stripe-signature' }, 400);
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, whSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: `Webhook signature: ${msg}` }, 400);
  }

  if (event.type !== 'checkout.session.completed') {
    return jsonResponse({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') {
    return jsonResponse({ received: true, skipped: 'not_paid' });
  }

  const meta = session.metadata ?? {};
  const purpose = meta.purpose;
  const authUserId = meta.supabase_user_id;
  const checkoutSessionId = session.id;
  const amountTotal = session.amount_total ?? null;
  const currency = session.currency ?? null;

  if (!checkoutSessionId || typeof authUserId !== 'string') {
    return jsonResponse({ received: true, skipped: 'bad_metadata' });
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
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('stripe_checkout_sessions').insert(row);
    if (error?.code === '23505') {
      return jsonResponse({ received: true, idempotent: true });
    }
    if (error) {
      console.error('stripe_checkout_sessions insert registration', error);
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ received: true });
  }

  if (purpose === 'renewal') {
    const profileId = meta.profile_id;
    if (typeof profileId !== 'string') {
      return jsonResponse({ received: true, skipped: 'no_profile_id' });
    }

    const { data: prof, error: pe } = await admin
      .from('profiles')
      .select('id, auth_user_id, membership_expires_at, status')
      .eq('id', profileId)
      .maybeSingle();

    if (pe || !prof || (prof.auth_user_id as string) !== authUserId) {
      return jsonResponse({ received: true, skipped: 'profile_mismatch' });
    }

    const st = prof.status as string;
    if (st !== 'active' && st !== 'expired') {
      return jsonResponse({ received: true, skipped: 'bad_status' });
    }

    const appliedAt = new Date().toISOString();
    const { error: insErr } = await admin.from('stripe_checkout_sessions').insert({
      checkout_session_id: checkoutSessionId,
      auth_user_id: authUserId,
      profile_id: profileId,
      purpose: 'renewal',
      payment_status: 'paid',
      amount_total: amountTotal,
      currency,
      renewal_applied_at: appliedAt,
      updated_at: appliedAt,
    });

    if (insErr) {
      if (insErr.code === '23505') {
        return jsonResponse({ received: true, idempotent: true });
      }
      console.error('stripe_checkout_sessions insert renewal', insErr);
      return jsonResponse({ error: insErr.message }, 500);
    }

    const now = new Date();
    const curExp = prof.membership_expires_at ? new Date(prof.membership_expires_at as string) : null;
    const start = curExp && curExp > now ? curExp : now;
    const newExp = addOneYear(start);

    const { error: upErr } = await admin
      .from('profiles')
      .update({
        membership_expires_at: newExp.toISOString(),
        status: 'active',
        show_on_register: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profileId);

    if (upErr) {
      console.error('profile renewal update', upErr);
      await admin.from('stripe_checkout_sessions').delete().eq('checkout_session_id', checkoutSessionId);
      return jsonResponse({ error: upErr.message }, 500);
    }

    return jsonResponse({ received: true, renewed: true });
  }

  return jsonResponse({ received: true, skipped: 'unknown_purpose' });
});
