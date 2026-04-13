import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const profileId = url.searchParams.get('profile_id');
  if (!profileId) {
    return jsonResponse({ error: 'profile_id required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: requester } = await admin
    .from('profiles')
    .select('id, auth_user_id, status, membership_expires_at')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();

  const meta = userData.user.user_metadata as Record<string, unknown> | undefined;
  const appMeta = userData.user.app_metadata as Record<string, unknown> | undefined;
  const isAdmin =
    meta?.is_admin === true ||
    appMeta?.is_admin === true;

  if (!isAdmin) {
    if (!requester) {
      return jsonResponse({ error: 'Profile required' }, 403);
    }
    const activeMember =
      requester.status === 'active' &&
      requester.membership_expires_at &&
      new Date(requester.membership_expires_at) > new Date();
    if (!activeMember && requester.id !== profileId) {
      return jsonResponse({ error: 'Membership not active' }, 403);
    }
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, auth_user_id, photo_url, status, show_on_register, membership_expires_at')
    .eq('id', profileId)
    .single();

  if (!target?.photo_url) {
    return jsonResponse({ error: 'No photo' }, 404);
  }

  const ownsTarget = target.auth_user_id === userData.user.id;
  const targetVisible =
    target.status === 'active' &&
    target.show_on_register === true &&
    target.membership_expires_at &&
    new Date(target.membership_expires_at) > new Date();

  if (!isAdmin && !ownsTarget && !targetVisible) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  if (!isAdmin && !ownsTarget && requester) {
    const activeViewer =
      requester.status === 'active' &&
      requester.membership_expires_at &&
      new Date(requester.membership_expires_at) > new Date();
    if (!activeViewer) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
  }

  const { data: signed, error: signErr } = await admin.storage
    .from('profile-photos')
    .createSignedUrl(target.photo_url, 3600);

  if (signErr || !signed?.signedUrl) {
    return jsonResponse({ error: 'Could not sign URL' }, 500);
  }

  if (req.method === 'GET' && url.searchParams.get('redirect') === '1') {
    return Response.redirect(signed.signedUrl, 302);
  }

  return jsonResponse({ signedUrl: signed.signedUrl });
});
