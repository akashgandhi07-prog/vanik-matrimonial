import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, EmailType } from '../_shared/dispatch-email.ts';

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
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const meta = userData.user.user_metadata as Record<string, unknown> | undefined;
  const appMeta = userData.user.app_metadata as Record<string, unknown> | undefined;
  const isAdmin =
    meta?.is_admin === true ||
    meta?.is_admin === 'true' ||
    appMeta?.is_admin === true;

  if (!isAdmin) {
    return jsonResponse({ error: 'Forbidden' }, 403);
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
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.type) return jsonResponse({ error: 'type required' }, 400);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return jsonResponse({ error: 'Email not configured' }, 500);

  const admin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const result = await dispatchEmail(admin, resendKey, {
    type: body.type,
    recipientProfileId: body.recipient_profile_id,
    recipientEmail: body.recipient_email,
    extraData: body.extraData ?? body.extra_data,
  });

  if (!result.ok) {
    return jsonResponse({ error: result.error ?? 'Send failed' }, 500);
  }
  return jsonResponse({ ok: true, messageId: result.messageId });
});
