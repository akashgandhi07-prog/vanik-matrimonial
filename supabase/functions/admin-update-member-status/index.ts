import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

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

  if (action === 'archive') {
    const { error } = await admin.from('profiles').update({
      status: 'archived',
      show_on_register: false,
      updated_at: new Date().toISOString(),
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      target_profile_id: profile_id,
      action_type: 'archived',
      notes: 'Manually archived by admin',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'reinstate') {
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    const { error } = await admin.from('profiles').update({
      status: 'active',
      show_on_register: true,
      membership_expires_at: expires.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', profile_id);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      target_profile_id: profile_id,
      action_type: 'reinstated',
      notes: 'Manually reinstated by admin — membership extended 1 year',
    });
    return jsonResponse({ ok: true }, req);
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
