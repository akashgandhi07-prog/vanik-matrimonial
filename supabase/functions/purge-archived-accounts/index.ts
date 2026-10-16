import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { escapeAlertText, sendOpsAlert } from '../_shared/ops-alert.ts';

// The deletion deadline is stored per-profile in `delete_after`, set when the account is
// closed. It is deliberately not derived from `updated_at`: that column is bumped by the
// profiles_updated_at trigger on every write, so any later edit used to push deletion back.

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();

  const { data: runRow } = await admin
    .from('cron_job_runs')
    .insert({ job_name: 'purge-archived-accounts', status: 'running', triggered_by: 'schedule' })
    .select('id')
    .single();
  const runId = runRow?.id as string | undefined;

  try {
    const { data: rows, error } = await admin
      .from('profiles')
      .select('id, auth_user_id')
      .eq('status', 'closed')
      .not('delete_after', 'is', null)
      .lt('delete_after', new Date().toISOString());

    if (error) {
      if (runId) {
        await admin
          .from('cron_job_runs')
          .update({ status: 'error', finished_at: new Date().toISOString(), result: { error: error.message } })
          .eq('id', runId);
      }
      return jsonResponse({ error: error.message }, req, 500);
    }

    let purged = 0;
    let skippedAdmins = 0;
    const failures: string[] = [];
    for (const r of rows ?? []) {
      const uid = r.auth_user_id as string;
      // Never delete a staff login, even if its member profile was closed: the
      // account is also how they sign in to the admin area.
      const { data: authUser } = await admin.auth.admin.getUserById(uid);
      if (authUser?.user && isUserAdmin(authUser.user)) {
        skippedAdmins++;
        continue;
      }
      // The email log keeps the row for statistics but should not keep their address.
      await admin.from('email_log').update({ recipient_email: null }).eq('recipient_profile_id', r.id as string);
      const { error: delErr } = await admin.auth.admin.deleteUser(uid);
      if (delErr) {
        console.error('purge-archived-accounts deleteUser', uid, delErr);
        failures.push(`profile ${r.id as string}: ${delErr.message}`);
        continue;
      }
      purged++;
    }
    const result = {
      purged_count: purged,
      eligible: (rows ?? []).length,
      skipped_admins: skippedAdmins,
      failed: failures.length,
    };
    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({
          status: failures.length ? 'error' : 'success',
          finished_at: new Date().toISOString(),
          result: failures.length ? { ...result, failures } : result,
        })
        .eq('id', runId);
    }
    if (failures.length) {
      await sendOpsAlert(
        `${failures.length} closed account(s) could not be deleted`,
        failures.map(escapeAlertText),
      );
    }
    return jsonResponse({ ok: failures.length === 0, ...result }, req);
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
