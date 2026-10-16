import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { applyRenewalPayment, renewalSessionFromStripe, type RenewalSession } from '../_shared/renewal.ts';

/**
 * Daily safety net for renewals: lists recently completed Checkout Sessions at
 * Stripe and applies any paid renewal we have no record of, e.g. a member who
 * closed the tab before Stripe redirected them back and a webhook that never
 * arrived. Body (all optional): { days?: number (default 14, max 90), dry_run?: boolean,
 * session_ids?: string[] (only these sessions, for applying by hand) }.
 */
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 90;

async function listCompletedSessions(secret: string, sinceUnix: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ status: 'complete', limit: '100', 'created[gte]': String(sinceUnix) });
    if (startingAfter) params.set('starting_after', startingAfter);
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${params}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const json = (await res.json()) as { data?: Record<string, unknown>[]; has_more?: boolean; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Stripe HTTP ${res.status}`);
    const data = json.data ?? [];
    out.push(...data);
    if (!json.has_more || data.length === 0) break;
    startingAfter = String(data[data.length - 1].id);
  }
  return out;
}

Deno.serve(async (req) => {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!secret) return jsonResponse({ error: 'Stripe is not configured on the server.' }, req, 503);

  let body: { days?: unknown; dry_run?: unknown; session_ids?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* cron sends {}; an empty body is fine too */
  }
  const daysRaw = Number(body.days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_LOOKBACK_DAYS) : DEFAULT_LOOKBACK_DAYS;
  const dryRun = body.dry_run === true;
  const onlyIds = Array.isArray(body.session_ids) ? new Set(body.session_ids.map(String)) : null;

  let raw: Record<string, unknown>[];
  try {
    raw = await listCompletedSessions(secret, Math.floor(Date.now() / 1000) - days * 86400);
  } catch (e) {
    console.error('reconcile-renewals: Stripe list failed', e);
    return jsonResponse({ error: e instanceof Error ? e.message : 'Stripe list failed' }, req, 502);
  }

  // Oldest first, so if a member paid twice the first payment is the one applied.
  const renewals: RenewalSession[] = raw
    .map(renewalSessionFromStripe)
    .filter((s) => s.paymentStatus === 'paid' && s.metadata.purpose === 'renewal')
    .filter((s) => !onlyIds || onlyIds.has(s.id))
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

  const admin = getAdminClient();
  const { data: known, error: knownErr } = renewals.length
    ? await admin
      .from('stripe_checkout_sessions')
      .select('checkout_session_id')
      .in('checkout_session_id', renewals.map((s) => s.id))
    : { data: [], error: null };
  if (knownErr) return jsonResponse({ error: knownErr.message }, req, 500);
  const recorded = new Set((known ?? []).map((r) => r.checkout_session_id as string));

  const results = [];
  for (const s of renewals) {
    const base = {
      checkout_session_id: s.id,
      profile_id: s.metadata.profile_id ?? null,
      opened_at: s.created ? new Date(s.created * 1000).toISOString() : null,
      amount_total: s.amountTotal,
      currency: s.currency,
    };
    if (recorded.has(s.id)) {
      results.push({ ...base, outcome: 'already_recorded' });
      continue;
    }
    if (dryRun) {
      results.push({ ...base, outcome: 'would_apply' });
      continue;
    }
    const outcome = await applyRenewalPayment(admin, s);
    if (outcome.status !== 'already_applied') {
      console.log(`reconcile-renewals: ${s.id} -> ${JSON.stringify(outcome)}`);
    }
    results.push({ ...base, outcome: outcome.status, detail: outcome });
  }

  return jsonResponse({
    dry_run: dryRun,
    lookback_days: days,
    completed_sessions: raw.length,
    paid_renewals: renewals.length,
    newly_handled: results.filter((r) => r.outcome !== 'already_recorded').length,
    results,
  }, req);
});
