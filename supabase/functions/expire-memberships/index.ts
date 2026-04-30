import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

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
    .insert({ job_name: 'expire-memberships', status: 'running', triggered_by: 'schedule' })
    .select('id')
    .single();
  const runId = runRow?.id as string | undefined;

  try {
    const mailOk = isTransactionalMailConfigured();
    const now = new Date().toISOString();

    const { data: rows, error } = await admin
      .from('profiles')
      .select('id')
      .in('status', ['active', 'matched'])
      .lt('membership_expires_at', now);

    if (error) {
      if (runId) {
        await admin
          .from('cron_job_runs')
          .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: error.message } })
          .eq('id', runId);
      }
      return jsonResponse({ error: error.message }, req, 500);
    }

    let expired = 0;
    for (const r of rows ?? []) {
      const pid = r.id as string;
      const { error: up } = await admin
        .from('profiles')
        .update({ status: 'expired', show_on_register: false })
        .eq('id', pid);
      if (up) continue;
      expired++;

      if (mailOk) {
        const since = new Date(Date.now() - 3 * 864e5).toISOString();
        const { count } = await admin
          .from('email_log')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_profile_id', pid)
          .eq('email_type', 'membership_expired')
          .gte('sent_at', since);
        if ((count ?? 0) === 0) {
          await dispatchEmail(admin, {
            type: 'membership_expired',
            recipientProfileId: pid,
          });
        }
      }
    }

    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), result: { expired_count: expired } })
        .eq('id', runId);
    }

    return jsonResponse({ ok: true, expired_count: expired }, req);
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
