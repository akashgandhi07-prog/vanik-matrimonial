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
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const now = new Date().toISOString();

  const { data: rows, error } = await admin
    .from('profiles')
    .select('id')
    .eq('status', 'active')
    .lt('membership_expires_at', now);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
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

    if (resendKey) {
      const since = new Date(Date.now() - 3 * 864e5).toISOString();
      const { count } = await admin
        .from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_profile_id', pid)
        .eq('email_type', 'membership_expired')
        .gte('sent_at', since);
      if ((count ?? 0) === 0) {
        await dispatchEmail(admin, resendKey, {
          type: 'membership_expired',
          recipientProfileId: pid,
        });
      }
    }
  }

  return jsonResponse({ ok: true, expired_count: expired });
});
