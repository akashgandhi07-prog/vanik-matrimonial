import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - 14 * 864e5);
  let deleted = 0;
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return jsonResponse({ error: error.message }, req, 500);
    }
    const users = data.users;
    const candidates = users.filter((u) => {
      if (u.email_confirmed_at) return false;
      if (isUserAdmin(u)) return false;
      const created = u.created_at ? new Date(u.created_at) : new Date();
      return created <= cutoff;
    });

    if (candidates.length > 0) {
      const candidateIds = candidates.map((u) => u.id);
      const [{ data: profRows }, { data: payRows }] = await Promise.all([
        admin.from('profiles').select('auth_user_id').in('auth_user_id', candidateIds),
        admin.from('stripe_checkout_sessions').select('auth_user_id').in('auth_user_id', candidateIds),
      ]);
      const keepIds = new Set<string>([
        ...(profRows ?? []).map((r) => String(r.auth_user_id ?? '')),
        ...(payRows ?? []).map((r) => String(r.auth_user_id ?? '')),
      ]);
      for (const u of candidates) {
        if (keepIds.has(u.id)) continue;
        const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
        if (!delErr) deleted++;
      }
    }
    if (users.length < perPage) break;
    page++;
  }

  // Diagnostics behind member-facing error codes are only useful while a member might still be
  // asking about them; drop anything older than 90 days so the table cannot grow unbounded.
  const errorLogCutoff = new Date(Date.now() - 90 * 864e5).toISOString();
  const { error: logErr } = await admin
    .from('client_error_log')
    .delete()
    .lt('created_at', errorLogCutoff);
  if (logErr) console.error('client_error_log retention', logErr.message);

  return jsonResponse({ ok: true, deleted }, req);
});
