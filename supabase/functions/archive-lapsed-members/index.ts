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
  const mailOk = isTransactionalMailConfigured();
  /** Expired members whose `membership_expires_at` is more than this many days in the past are archived. */
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString();

  const { data: rows, error } = await admin
    .from('profiles')
    .select('id')
    .eq('status', 'expired')
    .lt('membership_expires_at', cutoff);

  if (error) {
    return jsonResponse({ error: error.message }, req, 500);
  }

  let archived = 0;
  for (const r of rows ?? []) {
    const pid = r.id as string;
    const { error: up } = await admin
      .from('profiles')
      .update({ status: 'archived', show_on_register: false })
      .eq('id', pid);
    if (up) continue;
    archived++;

    if (mailOk) {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const { count } = await admin
        .from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_profile_id', pid)
        .eq('email_type', 'account_archived')
        .gte('sent_at', since);
      if ((count ?? 0) === 0) {
        await dispatchEmail(admin, {
          type: 'account_archived',
          recipientProfileId: pid,
        });
      }
    }
  }

  return jsonResponse({ ok: true, archived_count: archived }, req);
});
