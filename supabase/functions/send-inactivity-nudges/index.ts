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
      .select('id, auth_user_id, created_at, inactivity_nudge_sent_at, membership_expires_at')
      .eq('status', 'active')
      .is('hidden_reason', null);
    if (error) {
      await finish('error', { error: error.message });
      return jsonResponse({ error: error.message }, req, 500);
    }

    const candidates = (profiles ?? []).filter((p) => {
      const row = p as { membership_expires_at: string | null; inactivity_nudge_sent_at: string | null };
      if (!row.membership_expires_at || new Date(row.membership_expires_at) <= new Date()) return false;
      if (row.inactivity_nudge_sent_at && row.inactivity_nudge_sent_at > repeatCutoff) return false;
      return true;
    }) as {
      id: string;
      auth_user_id: string | null;
      created_at: string;
      inactivity_nudge_sent_at: string | null;
    }[];

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
      eligible++;

      const [{ count: newProfiles }, { count: waitingRequests }] = await Promise.all([
        admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .is('hidden_reason', null)
          .neq('id', p.id)
          .gt('created_at', seenAt),
        admin
          .from('requests')
          .select('id', { count: 'exact', head: true })
          .contains('candidate_ids', [p.id]),
      ]);

      const r = await dispatchEmail(admin, {
        type: 'inactivity_nudge',
        recipientProfileId: p.id,
        extraData: { new_profiles: newProfiles ?? 0, waiting_requests: waitingRequests ?? 0 },
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
