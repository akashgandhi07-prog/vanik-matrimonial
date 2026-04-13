import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

function isUserAdmin(user: { user_metadata?: unknown; app_metadata?: unknown }) {
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const a = user.app_metadata as Record<string, unknown> | undefined;
  return m?.is_admin === true || a?.is_admin === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const callerId = userData.user.id;

  let body: { action?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const action = body.action;
  const targetId = body.user_id;

  if (action === 'list') {
    const users: Array<{ id: string; email: string | undefined; is_admin: boolean; created_at: string }> = [];
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ error: error.message }, 500);
      const batch = data?.users ?? [];
      for (const u of batch) {
        const um = u.user_metadata as Record<string, unknown> | undefined;
        const am = u.app_metadata as Record<string, unknown> | undefined;
        const adminFlag = um?.is_admin === true || am?.is_admin === true;
        users.push({
          id: u.id,
          email: u.email,
          is_admin: adminFlag,
          created_at: u.created_at,
        });
      }
      if (batch.length < perPage) break;
      page++;
    }
    users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    return jsonResponse({ users });
  }

  if (!targetId || typeof targetId !== 'string') {
    return jsonResponse({ error: 'user_id required' }, 400);
  }

  if (action === 'promote') {
    const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
    if (gErr || !target.user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    const um = { ...(target.user.user_metadata as Record<string, unknown> | undefined), is_admin: true };
    const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { user_metadata: um });
    if (uErr) return jsonResponse({ error: uErr.message }, 500);
    return jsonResponse({ ok: true });
  }

  if (action === 'demote') {
    if (targetId === callerId) {
      return jsonResponse({ error: 'You cannot demote your own account' }, 400);
    }
    let adminCount = 0;
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ error: error.message }, 500);
      const batch = data?.users ?? [];
      for (const u of batch) {
        const um = u.user_metadata as Record<string, unknown> | undefined;
        const am = u.app_metadata as Record<string, unknown> | undefined;
        if (um?.is_admin === true || am?.is_admin === true) adminCount++;
      }
      if (batch.length < perPage) break;
      page++;
    }
    if (adminCount <= 1) {
      return jsonResponse({ error: 'Cannot demote the last admin' }, 400);
    }
    const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
    if (gErr || !target.user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    const um = { ...(target.user.user_metadata as Record<string, unknown> | undefined), is_admin: false };
    const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { user_metadata: um });
    if (uErr) return jsonResponse({ error: uErr.message }, 500);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
