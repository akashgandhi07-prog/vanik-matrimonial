import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

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
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  let body: { profile_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const profileId = body.profile_id;
  if (!profileId) return jsonResponse({ error: 'profile_id required' }, 400);

  const admin = getAdminClient();

  const { data: priv, error: pe } = await admin
    .from('member_private')
    .select('id_document_url')
    .eq('profile_id', profileId)
    .single();
  if (pe || !priv) {
    return jsonResponse({ error: 'Member not found' }, 404);
  }

  const idPath = priv.id_document_url as string | null;
  if (idPath) {
    const { error: remErr } = await admin.storage.from('id-documents').remove([idPath]);
    if (remErr) {
      return jsonResponse({ error: `ID document delete failed: ${remErr.message}` }, 500);
    }
  }

  const { error: upPriv } = await admin
    .from('member_private')
    .update({
      id_document_url: null,
      id_document_deleted_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId);
  if (upPriv) {
    return jsonResponse({ error: upPriv.message }, 500);
  }

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);

  const { data: prof } = await admin
    .from('profiles')
    .select('reference_number, gender')
    .eq('id', profileId)
    .single();

  let ref = prof?.reference_number as string | null;
  if (!ref && prof?.gender) {
    const { data: r, error: re } = await admin.rpc('assign_next_reference_number', {
      p_profile_id: profileId,
      p_gender: prof.gender,
    });
    if (re) return jsonResponse({ error: re.message }, 500);
    ref = r as string;
  }

  const { error: upProf } = await admin
    .from('profiles')
    .update({
      status: 'active',
      membership_expires_at: expires.toISOString(),
      photo_status: 'approved',
      show_on_register: true,
    })
    .eq('id', profileId);
  if (upProf) {
    return jsonResponse({ error: upProf.message }, 500);
  }

  await admin.from('admin_actions').insert({
    admin_user_id: userData.user.id,
    target_profile_id: profileId,
    action_type: 'approved',
    notes: stripHtml('Approved', 500),
  });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    await dispatchEmail(admin, resendKey, {
      type: 'registration_approved',
      recipientProfileId: profileId,
    });
  }

  return jsonResponse({ ok: true, reference_number: ref });
});
