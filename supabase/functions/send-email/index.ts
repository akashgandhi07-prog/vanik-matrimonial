import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin, adminMfaSatisfied, isSupportAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, EmailType } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

// Admin "Resend" from the email log. Only templates that can be rebuilt from the
// member's own profile are allowed, and the recipient is always the address on
// that profile: callers cannot supply HTML fragments or an arbitrary address.
const RESENDABLE: ReadonlySet<string> = new Set([
  'account_archived',
  'registration_received',
  'registration_approved',
  'registration_rejected',
  'membership_expired',
  'matched_congratulations',
  'photo_update_rejected',
  'admin_pending_reminder',
  'account_freeze_reminder',
  'rejection_followup',
]);

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
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  if (!isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }
  if (!adminMfaSatisfied(authHeader)) {
    return jsonResponse({ error: 'Two-factor verification required', code: 'mfa_required' }, req, 403);
  }
  if (isSupportAdmin(userData.user)) {
    return jsonResponse({ error: 'Support admin role cannot send emails' }, req, 403);
  }

  let body: { type?: string; recipient_profile_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const type = String(body.type ?? '');
  const profileId = typeof body.recipient_profile_id === 'string' ? body.recipient_profile_id : '';
  if (!RESENDABLE.has(type)) {
    return jsonResponse({ error: `"${type || 'unknown'}" emails cannot be resent from here` }, req, 400);
  }
  if (!profileId) {
    return jsonResponse({ error: 'This email has no member attached, so it cannot be resent' }, req, 400);
  }

  if (!isTransactionalMailConfigured()) {
    return jsonResponse({ error: 'Email not configured' }, req, 500);
  }

  const admin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // The two templates that normally get details from their caller read them
  // from the profile instead.
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('first_name, rejection_reason')
    .eq('id', profileId)
    .maybeSingle();
  if (profErr) return jsonResponse({ error: profErr.message }, req, 500);
  if (!prof) return jsonResponse({ error: 'Member not found' }, req, 404);
  const extraData: Record<string, unknown> = {};
  if (type === 'registration_received') extraData.first_name = prof.first_name ?? '';
  if (type === 'registration_rejected') {
    if (!prof.rejection_reason) {
      return jsonResponse({ error: 'No rejection reason on this profile to resend' }, req, 400);
    }
    extraData.reason = prof.rejection_reason;
  }

  const result = await dispatchEmail(admin, {
    type: type as EmailType,
    recipientProfileId: profileId,
    extraData,
  });

  if (!result.ok) {
    return jsonResponse({ error: result.error ?? 'Send failed' }, req, 500);
  }
  return jsonResponse({ ok: true, messageId: result.messageId }, req);
});
