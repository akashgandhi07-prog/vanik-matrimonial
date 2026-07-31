import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { replacePrimaryGalleryPhoto } from '../_shared/profile-photos.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';
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
    // Promote the approved photo in profile_photos as well - serve-photo and the
    // member gallery read that table first, so updating profiles.photo_url alone
    // would leave the approved image invisible (and the primary row pointing at a
    // deleted file). Only delete the old object once nothing references it.
    const { referenced, error: galErr } = await replacePrimaryGalleryPhoto(admin, profileId, pendingPath);
    if (galErr) return jsonResponse({ error: galErr }, req, 500);
    if (oldPath && oldPath !== pendingPath && !referenced.includes(oldPath)) {
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
    // Legacy fixed-name pending uploads could share their object with the live
    // gallery primary; never delete an object the gallery still references.
    const { data: refRows } = await admin
      .from('profile_photos')
      .select('id')
      .eq('storage_path', pendingPath)
      .limit(1);
    if (!refRows || refRows.length === 0) {
      await admin.storage.from('profile-photos').remove([pendingPath]);
    }
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
    if (isTransactionalMailConfigured()) {
      await dispatchEmail(admin, {
        type: 'photo_update_rejected',
        recipientProfileId: profileId,
      });
    }
  }

  return jsonResponse({ ok: true }, req);
});
