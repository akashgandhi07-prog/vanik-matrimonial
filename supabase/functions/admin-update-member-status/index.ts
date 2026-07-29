import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

/** Days a closed account is kept before purge-archived-accounts hard-deletes the auth user. */
const RETENTION_AFTER_CLOSE_DAYS = 90;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, req, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, req, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }
  if (isSupportAdmin(userData.user)) {
    return jsonResponse({ error: 'Support admin role cannot change member status' }, req, 403);
  }

  const body = await req.json().catch(() => ({})) as { profile_id?: string; action?: string };
  const { profile_id, action } = body;
  if (!profile_id || !action) return jsonResponse({ error: 'profile_id and action required' }, req, 400);

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  async function log(actionType: string, notes: string) {
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user!.id,
      target_profile_id: profile_id,
      action_type: actionType,
      notes,
    });
  }

  // Take the member off the register without ending their membership. Reversible, and
  // deliberately does NOT schedule deletion -- that is what 'close' is for.
  if (action === 'hide') {
    const { error } = await admin.from('profiles').update({
      hidden_reason: 'admin',
      updated_at: nowIso,
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await log('hidden', 'Hidden from the register by admin');
    return jsonResponse({ ok: true }, req);
  }

  // Clears any reason, including a member's own pause and a matched flag.
  if (action === 'unhide') {
    const { error } = await admin.from('profiles').update({
      hidden_reason: null,
      updated_at: nowIso,
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await log('unhidden', 'Restored to the register by admin');
    return jsonResponse({ ok: true }, req);
  }

  // Ends the membership and starts the retention clock. The member can still renew and
  // come back until delete_after passes.
  if (action === 'close') {
    const deleteAfter = new Date(Date.now() + RETENTION_AFTER_CLOSE_DAYS * 864e5).toISOString();
    const { error } = await admin.from('profiles').update({
      status: 'closed',
      hidden_reason: null,
      delete_after: deleteAfter,
      updated_at: nowIso,
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await log('closed', `Closed by admin - data deleted after ${deleteAfter}`);
    return jsonResponse({ ok: true, delete_after: deleteAfter }, req);
  }

  if (action === 'reopen') {
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    const { error } = await admin.from('profiles').update({
      status: 'active',
      hidden_reason: null,
      delete_after: null,
      membership_expires_at: expires.toISOString(),
      updated_at: nowIso,
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await log('reopened', 'Reopened by admin - membership extended 1 year');
    return jsonResponse({ ok: true }, req);
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
