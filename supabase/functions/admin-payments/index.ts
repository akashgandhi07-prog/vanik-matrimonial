import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

const LIST_LIMIT = 300;

type SessionRow = {
  checkout_session_id: string;
  auth_user_id: string;
  profile_id: string | null;
  purpose: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  payment_intent_id: string | null;
  refund_id: string | null;
  refund_amount: number | null;
  refunded_at: string | null;
  created_at: string;
};

async function stripeGet(secret: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? `Stripe GET ${path} failed`;
    throw new Error(msg);
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, req, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, req, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    checkout_session_id?: string;
    amount_pence?: number;
  };
  const admin = getAdminClient();

  if (body.action === 'list') {
    const { data: rows, error } = await admin
      .from('stripe_checkout_sessions')
      .select(
        'checkout_session_id, auth_user_id, profile_id, purpose, payment_status, amount_total, currency, payment_intent_id, refund_id, refund_amount, refunded_at, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return jsonResponse({ error: error.message }, req, 500);

    const sessions = (rows ?? []) as SessionRow[];

    // Resolve each payment to a member. Registration payments are recorded before the
    // profile exists, so profile_id is often null - match those via auth_user_id.
    const authIds = [...new Set(sessions.map((r) => r.auth_user_id))];
    const profilesByAuthId: Record<
      string,
      {
        id: string;
        first_name: string;
        reference_number: string | null;
        status: string;
        hidden_reason: string | null;
        membership_expires_at: string | null;
      }
    > = {};
    if (authIds.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, auth_user_id, first_name, reference_number, status, hidden_reason, membership_expires_at')
        .in('auth_user_id', authIds);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of (profs ?? []) as ({ auth_user_id: string } & (typeof profilesByAuthId)[string])[]) {
        profilesByAuthId[p.auth_user_id] = p;
      }
    }

    const profileIds = Object.values(profilesByAuthId).map((p) => p.id);
    const emailByProfileId: Record<string, string> = {};
    if (profileIds.length > 0) {
      const { data: privRows, error: mErr } = await admin
        .from('member_private')
        .select('profile_id, email')
        .in('profile_id', profileIds);
      if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
      for (const r of (privRows ?? []) as { profile_id: string; email: string | null }[]) {
        if (r.email) emailByProfileId[r.profile_id] = r.email;
      }
    }

    const payments = sessions.map((s) => {
      const prof = profilesByAuthId[s.auth_user_id] ?? null;
      return {
        ...s,
        profile_id: s.profile_id ?? prof?.id ?? null,
        member_name: prof?.first_name ?? null,
        member_reference: prof?.reference_number ?? null,
        member_status: prof?.status ?? null,
        member_hidden_reason: prof?.hidden_reason ?? null,
        member_expires_at: prof?.membership_expires_at ?? null,
        member_email: prof ? (emailByProfileId[prof.id] ?? null) : null,
      };
    });

    return jsonResponse({ payments, limit: LIST_LIMIT }, req);
  }

  if (body.action === 'refund') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot issue refunds' }, req, 403);
    }
    const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
    if (!secret) return jsonResponse({ error: 'Stripe is not configured on the server.' }, req, 503);

    const sessionId = body.checkout_session_id;
    if (typeof sessionId !== 'string' || !sessionId) {
      return jsonResponse({ error: 'checkout_session_id required' }, req, 400);
    }

    const { data: rowData, error: rowErr } = await admin
      .from('stripe_checkout_sessions')
      .select(
        'checkout_session_id, auth_user_id, profile_id, purpose, payment_status, amount_total, currency, payment_intent_id, refund_id'
      )
      .eq('checkout_session_id', sessionId)
      .maybeSingle();
    if (rowErr) return jsonResponse({ error: rowErr.message }, req, 500);
    if (!rowData) return jsonResponse({ error: 'Payment not found' }, req, 404);
    const row = rowData as SessionRow;

    if (row.payment_status !== 'paid') {
      return jsonResponse({ error: 'Only paid sessions can be refunded' }, req, 400);
    }
    if (row.refund_id) {
      return jsonResponse({ error: 'This payment has already been refunded' }, req, 400);
    }

    let amountPence: number | null = null;
    if (body.amount_pence != null) {
      amountPence = Math.floor(Number(body.amount_pence));
      if (!Number.isFinite(amountPence) || amountPence < 1) {
        return jsonResponse({ error: 'Refund amount must be a positive number of pence' }, req, 400);
      }
      if (row.amount_total != null && amountPence > row.amount_total) {
        return jsonResponse({ error: 'Refund amount exceeds the amount paid' }, req, 400);
      }
    }

    // Historical rows predate the payment_intent_id column - fetch it from Stripe.
    let paymentIntent = row.payment_intent_id;
    if (!paymentIntent) {
      try {
        const session = await stripeGet(secret, `checkout/sessions/${encodeURIComponent(sessionId)}`);
        paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : null;
      } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'Stripe lookup failed' }, req, 502);
      }
    }
    if (!paymentIntent) {
      return jsonResponse({ error: 'No payment intent found for this checkout session' }, req, 502);
    }

    const params = new URLSearchParams();
    params.append('payment_intent', paymentIntent);
    if (amountPence != null) params.append('amount', String(amountPence));

    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // One refund per checkout session from this tool. A retry (double-click, network
        // blip) replays the same refund instead of issuing a second one.
        'Idempotency-Key': `admin-refund-${sessionId}`,
      },
      body: params,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (json.error as { message?: string } | undefined)?.message ?? 'Stripe refund failed';
      return jsonResponse({ error: msg }, req, 502);
    }

    const refundId = typeof json.id === 'string' ? json.id : null;
    const refundedAmount = typeof json.amount === 'number' ? json.amount : amountPence;
    const nowIso = new Date().toISOString();

    const { error: upErr } = await admin
      .from('stripe_checkout_sessions')
      .update({
        refund_id: refundId,
        refund_amount: refundedAmount,
        refunded_at: nowIso,
        refunded_by: userData.user.id,
        payment_intent_id: paymentIntent,
        updated_at: nowIso,
      })
      .eq('checkout_session_id', sessionId);
    if (upErr) {
      // The refund went through at Stripe; surface the bookkeeping failure loudly so
      // the admin knows the row may still show as refundable.
      console.error('refund recorded at Stripe but local update failed', upErr);
      return jsonResponse(
        { error: `Refund issued at Stripe (${refundId ?? 'ok'}) but recording it locally failed: ${upErr.message}` },
        req,
        500
      );
    }

    const amountLabel =
      refundedAmount != null ? `${(refundedAmount / 100).toFixed(2)} ${(row.currency ?? 'gbp').toUpperCase()}` : 'full amount';
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      target_profile_id: row.profile_id,
      action_type: 'payment_refunded',
      notes: `Refunded ${amountLabel} for ${row.purpose} payment (checkout session ${sessionId})`,
    });

    return jsonResponse({ ok: true, refund_id: refundId, refund_amount: refundedAmount }, req);
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
