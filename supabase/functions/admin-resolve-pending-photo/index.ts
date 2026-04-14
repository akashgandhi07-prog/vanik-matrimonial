import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

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
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }
  if (isSupportAdmin(userData.user)) {
    return jsonResponse({ error: 'Support admin role cannot resolve pending photos' }, req, 403);
  }

  let body: { profile_id?: string; action?: 'approve' | 'reject' };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const profileId = body.profile_id;
  const action = body.action;
  if (!profileId || (action !== 'approve' && action !== 'reject')) {
    return jsonResponse({ error: 'profile_id and action approve|reject required' }, req, 400);
  }

  const admin = getAdminClient();
  const { data: profile, error: pe } = await admin
    .from('profiles')
    .select('id, photo_url, pending_photo_url')
    .eq('id', profileId)
    .single();
  if (pe || !profile?.pending_photo_url) {
    return jsonResponse({ error: 'No pending photo' }, req, 400);
  }

  const pendingPath = profile.pending_photo_url as string;
  const oldPath = profile.photo_url as string | null;

  if (action === 'approve') {
    if (oldPath && oldPath !== pendingPath) {
      await admin.storage.from('profile-photos').remove([oldPath]);
    }
    const { error: up } = await admin
      .from('profiles')
      .update({
        photo_url: pendingPath,
        pending_photo_url: null,
        photo_status: 'approved',
      })
      .eq('id', profileId);
    if (up) return jsonResponse({ error: up.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      action_type: 'photo_approved',
      target_profile_id: profileId,
      notes: stripHtml('Pending photo approved', 500),
    });
  } else {
    await admin.storage.from('profile-photos').remove([pendingPath]);
    const { error: up } = await admin
      .from('profiles')
      .update({
        pending_photo_url: null,
        photo_status: 'approved',
      })
      .eq('id', profileId);
    if (up) return jsonResponse({ error: up.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      action_type: 'photo_rejected',
      target_profile_id: profileId,
      notes: stripHtml('Pending photo rejected', 500),
    });
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey) {
      await dispatchEmail(admin, resendKey, {
        type: 'photo_update_rejected',
        recipientProfileId: profileId,
      });
    }
  }

  return jsonResponse({ ok: true }, req);
});
