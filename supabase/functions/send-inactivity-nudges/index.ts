import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

/** Nudge members who have not signed in for this long. */
const INACTIVE_DAYS = 14;
/** Never nudge the same member more often than this. */
const REPEAT_AFTER_DAYS = 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();

  const { data: runRow } = await admin
    .from('cron_job_runs')
    .insert({ job_name: 'send-inactivity-nudges', status: 'running', triggered_by: 'schedule' })
    .select('id')
    .single();
  const runId = runRow?.id as string | undefined;

  const finish = async (status: 'success' | 'error', result: Record<string, unknown>) => {
    if (!runId) return;
    await admin
      .from('cron_job_runs')
      .update({ status, finished_at: new Date().toISOString(), result })
      .eq('id', runId);
  };

  if (!isTransactionalMailConfigured()) {
    await finish('success', { skipped: true, reason: 'mail_not_configured' });
    return jsonResponse({ ok: true, skipped: true }, req);
  }

  try {
    const now = Date.now();
    const inactiveCutoff = new Date(now - INACTIVE_DAYS * 864e5).toISOString();
    const repeatCutoff = new Date(now - REPEAT_AFTER_DAYS * 864e5).toISOString();

    // Only listed, active members with a live membership: paused, matched, and
    // admin-hidden members should not be told to come back and browse.
    const { data: profiles, error } = await admin
      .from('profiles')
      .select(
        'id, auth_user_id, gender, seeking_gender, created_at, inactivity_nudge_sent_at, membership_expires_at, status, hidden_reason'
      );
    if (error) {
      await finish('error', { error: error.message });
      return jsonResponse({ error: error.message }, req, 500);
    }

    type ProfileRow = {
      id: string;
      auth_user_id: string | null;
      gender: string | null;
      seeking_gender: string | null;
      created_at: string;
      inactivity_nudge_sent_at: string | null;
      membership_expires_at: string | null;
      status: string;
      hidden_reason: string | null;
    };
    const allProfiles = (profiles ?? []) as ProfileRow[];
    /** Profiles a member could actually see in Browse today. */
    const browsable = allProfiles.filter(
      (p) =>
        p.status === 'active' &&
        p.hidden_reason == null &&
        !!p.membership_expires_at &&
        new Date(p.membership_expires_at) > new Date()
    );

    // Requests are used twice: to skip candidates the member already asked
    // about, and to count people waiting for them.
    const { data: requestRows, error: rqErr } = await admin
      .from('requests')
      .select('requester_id, candidate_ids, created_at');
    if (rqErr) {
      await finish('error', { error: rqErr.message });
      return jsonResponse({ error: rqErr.message }, req, 500);
    }
    const allRequests = (requestRows ?? []) as {
      requester_id: string | null;
      candidate_ids: string[] | null;
      created_at: string;
    }[];

    const candidates = browsable.filter(
      (p) => !(p.inactivity_nudge_sent_at && p.inactivity_nudge_sent_at > repeatCutoff)
    );

    // Last sign-in lives in auth.users.
    const lastSignIn = new Map<string, string | null>();
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error: auErr } = await admin.auth.admin.listUsers({ page, perPage });
      if (auErr) break;
      const batch = data?.users ?? [];
      for (const u of batch) {
        lastSignIn.set(u.id, (u as { last_sign_in_at?: string | null }).last_sign_in_at ?? null);
      }
      if (batch.length < perPage) break;
      page++;
    }

    let sent = 0;
    let eligible = 0;
    const errors: string[] = [];

    for (const p of candidates) {
      const seenAt = p.auth_user_id ? lastSignIn.get(p.auth_user_id) ?? null : null;
      // Never signed in at all: registration/approval emails cover them, and a
      // "you have not been back" note would be confusing. Skip.
      if (!seenAt) continue;
      if (seenAt > inactiveCutoff) continue;

      // Who this member is actually shown in Browse.
      const seeking = p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female');
      // Everyone they have already asked about: those are not "new to you".
      const alreadyRequested = new Set<string>();
      for (const r of allRequests) {
        if (r.requester_id !== p.id) continue;
        for (const cid of r.candidate_ids ?? []) alreadyRequested.add(cid);
      }

      const newProfiles = browsable.filter(
        (c) =>
          c.id !== p.id &&
          (seeking === 'Both' || c.gender === seeking) &&
          c.created_at > seenAt &&
          !alreadyRequested.has(c.id)
      ).length;

      // People who asked for their details since they were last here, deduped
      // by requester so two requests from one person count once.
      const newRequesters = new Set<string>();
      for (const r of allRequests) {
        if (!r.requester_id || r.created_at <= seenAt) continue;
        if ((r.candidate_ids ?? []).includes(p.id)) newRequesters.add(r.requester_id);
      }
      const waitingRequests = newRequesters.size;

      // Nothing new to come back for: stay quiet rather than send a hollow nudge.
      if (newProfiles === 0 && waitingRequests === 0) continue;
      eligible++;

      const r = await dispatchEmail(admin, {
        type: 'inactivity_nudge',
        recipientProfileId: p.id,
        extraData: { new_profiles: newProfiles, waiting_requests: waitingRequests },
      });
      if (!r.ok) {
        errors.push(`${p.id}: ${r.error ?? 'send failed'}`);
        continue;
      }
      sent++;
      const { error: upErr } = await admin
        .from('profiles')
        .update({ inactivity_nudge_sent_at: new Date().toISOString() })
        .eq('id', p.id);
      if (upErr) errors.push(`${p.id}: sent but failed to mark: ${upErr.message}`);
    }

    await finish('success', { sent, eligible, errors: errors.length ? errors.slice(0, 20) : undefined });
    return jsonResponse({ ok: true, sent, eligible, errors: errors.length ? errors : undefined }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish('error', { error: message });
    return jsonResponse({ error: message }, req, 500);
  }
});
