import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

/** Days after archival (`profiles.updated_at`) before the auth user (and cascaded profile) is deleted. */
const RETENTION_AFTER_ARCHIVE_MS = 90 * 864e5;

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
    const cutoff = new Date(Date.now() - RETENTION_AFTER_ARCHIVE_MS).toISOString();

    const { data: rows, error } = await admin
      .from('profiles')
      .select('id, auth_user_id')
      .eq('status', 'archived')
      .lt('updated_at', cutoff);

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
    for (const r of rows ?? []) {
      const uid = r.auth_user_id as string;
      const { error: delErr } = await admin.auth.admin.deleteUser(uid);
      if (delErr) {
        console.error('purge-archived-accounts deleteUser', uid, delErr);
        continue;
      }
      purged++;
    }

    if (runId) {
      await admin
        .from('cron_job_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          result: { purged_count: purged, eligible: (rows ?? []).length },
        })
        .eq('id', runId);
    }

    return jsonResponse({ ok: true, purged_count: purged, eligible: (rows ?? []).length }, req);
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
