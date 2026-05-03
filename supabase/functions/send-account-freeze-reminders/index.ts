import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

/** ~one month after freezing; job runs daily so a 30-day threshold is fine. */
const FREEZE_REMINDER_DAYS = 30;

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
    .insert({ job_name: 'send-account-freeze-reminders', status: 'running', triggered_by: 'schedule' })
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
    const cutoff = new Date(Date.now() - FREEZE_REMINDER_DAYS * 864e5).toISOString();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, first_name, browse_paused_at')
      .eq('browse_paused', true)
      .eq('status', 'active')
      .not('browse_paused_at', 'is', null)
      .lte('browse_paused_at', cutoff)
      .is('account_freeze_reminder_sent_at', null);

    if (error) {
      if (runId) {
        await admin
          .from('cron_job_runs')
          .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: error.message } })
          .eq('id', runId);
      }
      return jsonResponse({ error: error.message }, req, 500);
    }

    let sent = 0;
    const errors: string[] = [];

    for (const row of profiles ?? []) {
      const pid = row.id as string;

      const { count: alreadyLogged } = await admin
        .from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_profile_id', pid)
        .eq('email_type', 'account_freeze_reminder')
        .eq('status', 'sent');
      if ((alreadyLogged ?? 0) > 0) {
        await admin
          .from('profiles')
          .update({ account_freeze_reminder_sent_at: new Date().toISOString() })
          .eq('id', pid)
          .is('account_freeze_reminder_sent_at', null);
        continue;
      }

      const r = await dispatchEmail(admin, {
        type: 'account_freeze_reminder',
        recipientProfileId: pid,
      });
      if (!r.ok) {
        errors.push(`${pid}: ${r.error ?? 'send failed'}`);
        continue;
      }
      sent++;
      const { error: upErr } = await admin
        .from('profiles')
        .update({ account_freeze_reminder_sent_at: new Date().toISOString() })
        .eq('id', pid);
      if (upErr) {
        errors.push(`${pid}: sent but failed to mark: ${upErr.message}`);
      }
    }

    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          result: { sent, eligible: (profiles ?? []).length, errors: errors.length ? errors.slice(0, 20) : undefined },
        })
        .eq('id', runId);
    }

    return jsonResponse({ ok: true, sent, eligible: (profiles ?? []).length, errors: errors.length ? errors : undefined }, req);
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
