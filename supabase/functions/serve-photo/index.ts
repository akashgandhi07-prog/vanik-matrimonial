import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const url = new URL(req.url);
  const profileId = url.searchParams.get('profile_id');
  if (!profileId) {
    return jsonResponse({ error: 'profile_id required' }, req, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: requester } = await admin
    .from('profiles')
    .select('id, auth_user_id, status, membership_expires_at')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();

  const isAdmin = isUserAdmin(userData.user);

  if (!isAdmin) {
    if (!requester) {
      return jsonResponse({ error: 'Profile required' }, req, 403);
    }

    const ownsTarget = requester.id === profileId;

    if (!ownsTarget) {
      // Non-admin members may only view photos of profiles they have explicitly requested.
      // Check requests: the viewer must have a request where profileId is in candidate_ids.
      const { count } = await admin
        .from('requests')
        .select('id', { count: 'exact', head: true })
        .eq('requester_id', requester.id)
        .contains('candidate_ids', [profileId]);

      if (!count || count === 0) {
        return jsonResponse({ error: 'Forbidden: photo only available after contact details have been requested' }, req, 403);
      }
    }
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, auth_user_id, photo_url, status, show_on_register, membership_expires_at')
    .eq('id', profileId)
    .single();

  const { data: photoRows } = await admin
    .from('profile_photos')
    .select('storage_path')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });

  const pathsFromTable =
    photoRows?.map((r) => r.storage_path).filter((p): p is string => typeof p === 'string' && p.length > 0) ?? [];
  const uniquePaths = [...new Set(pathsFromTable)];
  const storagePaths =
    uniquePaths.length > 0
      ? uniquePaths
      : target?.photo_url
        ? [target.photo_url]
        : [];

  if (!storagePaths.length) {
    return jsonResponse({ error: 'No photo' }, req, 404);
  }

  const signedList: string[] = [];
  for (const path of storagePaths) {
    const { data: signed, error: signErr } = await admin.storage
      .from('profile-photos')
      .createSignedUrl(path, 3600);
    if (signErr || !signed?.signedUrl) {
      return jsonResponse({ error: 'Could not sign URL' }, req, 500);
    }
    signedList.push(signed.signedUrl);
  }

  const primary = signedList[0]!;

  if (req.method === 'GET' && url.searchParams.get('redirect') === '1') {
    return Response.redirect(primary, 302);
  }

  return jsonResponse({ signedUrl: primary, signedUrls: signedList }, req);
});
