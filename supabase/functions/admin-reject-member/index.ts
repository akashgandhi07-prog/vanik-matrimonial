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

  let body: { profile_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const profileId = body.profile_id;
  const reason = stripHtml(String(body.reason ?? ''), 2000);
  if (!profileId || !reason) {
    return jsonResponse({ error: 'profile_id and reason required' }, 400);
  }

  const admin = getAdminClient();

  const { error: upProf } = await admin
    .from('profiles')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      show_on_register: false,
    })
    .eq('id', profileId);
  if (upProf) {
    return jsonResponse({ error: upProf.message }, 500);
  }

  await admin.from('admin_actions').insert({
    admin_user_id: userData.user.id,
    target_profile_id: profileId,
    action_type: 'rejected',
    notes: reason,
  });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    await dispatchEmail(admin, resendKey, {
      type: 'registration_rejected',
      recipientProfileId: profileId,
      extra_data: { reason },
    });
  }

  return jsonResponse({ ok: true });
});
