import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

/**
 * Returns the caller's profile + member_private using the service role, scoped by JWT user id.
 * Used when client-side RLS reads fail briefly after login; never exposes other members' rows.
 *
 * If profiles.auth_user_id does not match (e.g. auth user was recreated) but member_private.email
 * matches the JWT email and the previous auth user no longer exists, we re-link auth_user_id once.
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

  let { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('*')
    .eq('auth_user_id', uid)
    .maybeSingle();

  if (pErr) {
    return jsonResponse({ error: pErr.message }, req, 500);
  }

  if (!profile && userData.user.email) {
    const emailNorm = userData.user.email.trim().toLowerCase();
    const { data: privRows, error: privErr } = await admin
      .from('member_private')
      .select('profile_id')
      .eq('email', emailNorm)
      .limit(1);

    if (privErr) {
      return jsonResponse({ error: privErr.message }, req, 500);
    }

    const profileId = (privRows?.[0] as { profile_id?: string } | undefined)?.profile_id;
    if (profileId) {
      const { data: p2, error: p2Err } = await admin
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();

      if (p2Err) {
        return jsonResponse({ error: p2Err.message }, req, 500);
      }

      if (p2) {
        const currentAuth = p2.auth_user_id as string;
        if (currentAuth === uid) {
          profile = p2;
        } else {
          let previousAuthGone = false;
          try {
            const { data: uOld, error: uOldErr } = await admin.auth.admin.getUserById(currentAuth);
            previousAuthGone = !!uOldErr || !uOld?.user;
          } catch {
            previousAuthGone = true;
          }

          if (previousAuthGone) {
            const { error: upErr } = await admin
              .from('profiles')
              .update({ auth_user_id: uid })
              .eq('id', p2.id as string);
            if (!upErr) {
              profile = { ...p2, auth_user_id: uid };
            }
          }
        }
      }
    }
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
