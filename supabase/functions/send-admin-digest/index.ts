import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const digestTo =
    Deno.env.get('ADMIN_DIGEST_EMAIL') ?? Deno.env.get('ADMIN_NOTIFY_EMAIL') ?? 'mahesh.gandhi@vanikcouncil.uk';

  if (!resendKey) {
    return jsonResponse({ ok: true, skipped: true, reason: 'no_resend' }, req);
  }

  const { count: pending } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval');

  const startYesterday = new Date();
  startYesterday.setUTCDate(startYesterday.getUTCDate() - 1);
  startYesterday.setUTCHours(0, 0, 0, 0);
  const endYesterday = new Date();
  endYesterday.setUTCHours(0, 0, 0, 0);

  const { count: requests_yesterday } = await admin
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startYesterday.toISOString())
    .lt('created_at', endYesterday.toISOString());

  const monthEnd = new Date();
  monthEnd.setDate(monthEnd.getDate() + 30);
  const { count: expiring } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .lte('membership_expires_at', monthEnd.toISOString())
    .gte('membership_expires_at', new Date().toISOString());

  const { count: flagged } = await admin
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('is_flagged', true);

  const metrics = {
    pending: pending ?? 0,
    requests_yesterday: requests_yesterday ?? 0,
    expiring: expiring ?? 0,
    flagged: flagged ?? 0,
  };

  const sum = metrics.pending + metrics.requests_yesterday + metrics.expiring + metrics.flagged;
  if (sum === 0) {
    return jsonResponse({ ok: true, skipped: true, reason: 'no_metrics' }, req);
  }

  await dispatchEmail(admin, resendKey, {
    type: 'admin_daily_digest',
    recipientEmail: digestTo,
    extraData: metrics,
  });

  return jsonResponse({ ok: true, metrics }, req);
});
