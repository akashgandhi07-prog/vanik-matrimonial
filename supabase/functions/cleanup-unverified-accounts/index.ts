import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
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
    for (const u of users) {
      if (u.email_confirmed_at) continue;
      const created = u.created_at ? new Date(u.created_at) : new Date();
      if (created > cutoff) continue;
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (!delErr) deleted++;
    }
    if (users.length < perPage) break;
    page++;
  }

  return jsonResponse({ ok: true, deleted }, req);
});
