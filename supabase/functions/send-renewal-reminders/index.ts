import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
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

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), result: { skipped: true, reason: 'no_resend' } })
        .eq('id', runId);
    }
    return jsonResponse({ ok: true, skipped: true, reason: 'no_resend' });
  }

  try {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 864e5).toISOString();
    const dedupeSince = new Date(now.getTime() - 6 * 864e5).toISOString();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, membership_expires_at')
      .eq('status', 'active')
      .gt('membership_expires_at', now.toISOString())
      .lte('membership_expires_at', in30);

    if (error) {
      if (runId) {
        await admin
          .from('cron_job_runs')
          .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: error.message } })
          .eq('id', runId);
      }
      return jsonResponse({ error: error.message }, 500);
    }

    let sent = 0;
    for (const p of profiles ?? []) {
      const pid = p.id as string;
      const exp = new Date(p.membership_expires_at as string);
      const days = Math.ceil((exp.getTime() - now.getTime()) / 864e5);

      const { count } = await admin
        .from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_profile_id', pid)
        .eq('email_type', 'renewal_reminder')
        .gte('sent_at', dedupeSince);
      if ((count ?? 0) > 0) continue;

      const r = await dispatchEmail(admin, resendKey, {
        type: 'renewal_reminder',
        recipientProfileId: pid,
        extraData: { days },
      });
      if (r.ok) sent++;
    }

    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'success', finished_at: new Date().toISOString(), result: { sent } })
        .eq('id', runId);
    }

    return jsonResponse({ ok: true, sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: message } })
        .eq('id', runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
