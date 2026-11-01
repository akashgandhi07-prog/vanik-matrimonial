import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import {
  collectMemberStoragePaths,
  removeMemberStorage,
  snapshotFeedbackNamesForProfiles,
} from '../_shared/member-deletion.ts';
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

    const profileIds = (rows ?? []).map((r) => r.id as string);
    // Photos and ID documents must go too, and their paths are only findable
    // before the auth cascade deletes the rows. Without them, stop rather than
    // leave files behind that nothing points at.
    const { byProfile: storageByProfile, error: pathErr } = await collectMemberStoragePaths(admin, profileIds);
    if (pathErr) throw new Error(`collect member storage: ${pathErr}`);
    await snapshotFeedbackNamesForProfiles(admin, profileIds);

    let purged = 0;
    let skippedAdmins = 0;
    const failures: string[] = [];
    for (const r of rows ?? []) {
      const uid = r.auth_user_id as string;
      const pid = r.id as string;
      // Never delete a staff login, even if its member profile was closed: the
      // account is also how they sign in to the admin area. If the lookup fails we
      // cannot tell, so skip this run rather than risk deleting an admin.
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(uid);
      if (authErr || !authUser?.user) {
        failures.push(`profile ${pid}: auth lookup failed (${authErr?.message ?? 'no user'}), skipped`);
        continue;
      }
      if (isUserAdmin(authUser.user)) {
        skippedAdmins++;
        continue;
      }
      // The email log keeps the row for statistics but should not keep their address.
      await admin.from('email_log').update({ recipient_email: null }).eq('recipient_profile_id', pid);
      const { error: delErr } = await admin.auth.admin.deleteUser(uid);
      if (delErr) {
        console.error('purge-archived-accounts deleteUser', uid, delErr);
        failures.push(`profile ${pid}: ${delErr.message}`);
        continue;
      }
      purged++;
      const paths = storageByProfile.get(pid);
      for (const e of paths ? await removeMemberStorage(admin, paths) : []) {
        failures.push(`profile ${pid} deleted but files remain: ${e}`);
      }
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
