import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, EmailType } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

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

  let body: {
    type?: EmailType;
    recipient_profile_id?: string;
    recipient_email?: string;
    extra_data?: Record<string, unknown>;
    extraData?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  if (!body.type) return jsonResponse({ error: 'type required' }, req, 400);

  if (!isTransactionalMailConfigured()) {
    return jsonResponse({ error: 'Email not configured' }, req, 500);
  }

  const admin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const result = await dispatchEmail(admin, {
    type: body.type,
    recipientProfileId: body.recipient_profile_id,
    recipientEmail: body.recipient_email,
    extraData: body.extraData ?? body.extra_data,
  });

  if (!result.ok) {
    return jsonResponse({ error: result.error ?? 'Send failed' }, req, 500);
  }
  return jsonResponse({ ok: true, messageId: result.messageId }, req);
});
