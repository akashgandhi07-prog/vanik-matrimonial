import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

/**
 * Returns the caller's profile + member_private using the service role, scoped by JWT user id.
 * Used when client-side RLS reads fail briefly after login; never exposes other members' rows.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: userErr?.message ?? 'Unauthorized' }, req, 401);
  }

  if (isUserAdmin(userData.user)) {
    return jsonResponse({ is_admin: true, profile: null, member_private: null }, req);
  }

  const uid = userData.user.id;
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('*')
    .eq('auth_user_id', uid)
    .maybeSingle();

  if (pErr) {
    return jsonResponse({ error: pErr.message }, req, 500);
  }
  if (!profile) {
    return jsonResponse({ profile: null, member_private: null }, req);
  }

  const { data: member_private, error: mErr } = await admin
    .from('member_private')
    .select('*')
    .eq('profile_id', profile.id as string)
    .maybeSingle();

  if (mErr) {
    return jsonResponse({ error: mErr.message }, req, 500);
  }

  return jsonResponse(
    {
      profile,
      member_private: member_private ?? null,
    },
    req
  );
});
