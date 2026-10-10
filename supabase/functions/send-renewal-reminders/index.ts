import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';
import { londonDaysBetween, MEMBERSHIP_GRACE_DAYS, membershipAccessCutoffIso } from '../_shared/membership.ts';

type AdminClient = ReturnType<typeof getAdminClient>;

/**
 * UK calendar days before the membership ends on which a reminder goes out: 30, 14, 7
 * and 3 days ahead, on the day itself, then once more 3 days before the grace period
 * ends and the profile is hidden.
 */
const REMINDER_MILESTONES = [30, 14, 7, 3, 0, -(MEMBERSHIP_GRACE_DAYS - 3)];

/** The milestone this member is currently in, or null when they are more than 30 days out. */
function currentMilestone(days: number): number | null {
  const reached = REMINDER_MILESTONES.filter((m) => days <= m);
  return reached.length ? Math.min(...reached) : null;
}

/**
 * Per member: the free period they joined on (if they have never paid to renew) and
 * how many different members have requested their details, the strongest reason to stay.
 */
async function loadReminderContext(admin: AdminClient, profileIds: string[]) {
  const trialMonths = new Map<string, number>();
  const requesters = new Map<string, number>();
  if (profileIds.length === 0) return { trialMonths, requesters };

  const [{ data: privRows }, { data: coupons }, { data: renewals }, { data: requestRows }] = await Promise.all([
    admin.from('member_private').select('profile_id, coupon_used').in('profile_id', profileIds),
    admin.from('coupons').select('code, type, free_months'),
    admin
      .from('stripe_checkout_sessions')
      .select('profile_id')
      .eq('purpose', 'renewal')
      .eq('payment_status', 'paid')
      .in('profile_id', profileIds),
    admin.from('requests').select('requester_id, candidate_ids').overlaps('candidate_ids', profileIds),
  ]);

  const freeCoupons = new Map<string, number>();
  for (const c of coupons ?? []) {
    // A free coupon without free_months granted the standard 12 months.
    if (c.type === 'free') freeCoupons.set(String(c.code).toUpperCase(), (c.free_months as number | null) ?? 12);
  }
  const renewed = new Set((renewals ?? []).map((r) => r.profile_id as string));
  for (const m of privRows ?? []) {
    const pid = m.profile_id as string;
    const months = m.coupon_used ? freeCoupons.get(String(m.coupon_used).toUpperCase()) : undefined;
    if (months != null && !renewed.has(pid)) trialMonths.set(pid, months);
  }

  const wanted = new Set(profileIds);
  const byCandidate = new Map<string, Set<string>>();
  for (const r of requestRows ?? []) {
    for (const cid of (r.candidate_ids as string[]) ?? []) {
      if (!wanted.has(cid)) continue;
      if (!byCandidate.has(cid)) byCandidate.set(cid, new Set());
      byCandidate.get(cid)!.add(r.requester_id as string);
    }
  }
  for (const [cid, set] of byCandidate) requesters.set(cid, set.size);

  return { trialMonths, requesters };
}


Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();

  // Insert run log row
  const { data: runRow } = await admin
    .from('cron_job_runs')
    .insert({ job_name: 'send-renewal-reminders', status: 'running', triggered_by: 'schedule' })
    .select('id')
    .single();
  const runId = runRow?.id as string | undefined;

  if (!isTransactionalMailConfigured()) {
    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), result: { skipped: true, reason: 'no_resend' } })
        .eq('id', runId);
    }
    return jsonResponse({ ok: true, skipped: true, reason: 'no_resend' }, req);
  }

  try {
    const now = new Date();
    // One day of slack so a member 30 UK calendar days out is never missed on timestamp rounding.
    const horizon = new Date(now.getTime() + 31 * 864e5).toISOString();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, membership_expires_at')
      .eq('status', 'active')
      .gt('membership_expires_at', membershipAccessCutoffIso(now))
      .lte('membership_expires_at', horizon);

    if (error) {
      if (runId) {
        await admin
          .from('cron_job_runs')
          .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: error.message } })
          .eq('id', runId);
      }
      return jsonResponse({ error: error.message }, req, 500);
    }

    const due: { id: string; exp: Date; days: number; milestone: number }[] = [];
    for (const p of profiles ?? []) {
      const exp = new Date(p.membership_expires_at as string);
      const days = londonDaysBetween(now, exp);
      const milestone = currentMilestone(days);
      if (milestone != null) due.push({ id: p.id as string, exp, days, milestone });
    }

    const context = await loadReminderContext(admin, due.map((d) => d.id));

    let sent = 0;
    for (const d of due) {
      // Skip when a reminder has already gone out at (or after) this milestone.
      const { data: last } = await admin
        .from('email_log')
        .select('sent_at')
        .eq('recipient_profile_id', d.id)
        .eq('email_type', 'renewal_reminder')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.sent_at && londonDaysBetween(new Date(last.sent_at as string), d.exp) <= d.milestone) continue;

      const r = await dispatchEmail(admin, {
        type: 'renewal_reminder',
        recipientProfileId: d.id,
        extraData: {
          days: d.days,
          trial_months: context.trialMonths.get(d.id) ?? null,
          requesters: context.requesters.get(d.id) ?? 0,
        },
      });
      if (r.ok) sent++;
    }

    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), result: { sent } })
        .eq('id', runId);
    }

    return jsonResponse({ ok: true, sent }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: message } })
        .eq('id', runId);
    }
    return jsonResponse({ error: message }, req, 500);
  }
});
