import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { allowFunctionRateLimit } from '../_shared/function-rate-limit.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';

/** Days between a member asking to leave and the auth user being hard-deleted. */
const RETENTION_AFTER_CLOSE_DAYS = 90;

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

  const admin = getAdminClient();
  const allowed = await allowFunctionRateLimit(admin, {
    scope: 'request_account_deletion',
    rateKey: userData.user.id,
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!allowed) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, req, 429);
  }

  const { data: prof } = await admin
    .from('profiles')
    .select('id, status')
    .eq('auth_user_id', userData.user.id)
    .single();
  if (!prof) {
    return jsonResponse({ error: 'No profile' }, req, 400);
  }
  if (prof.status === 'closed') {
    return jsonResponse({ ok: true, already_closed: true }, req);
  }

  await admin
    .from('profiles')
    .update({
      status: 'closed',
      hidden_reason: null,
      delete_after: new Date(Date.now() + RETENTION_AFTER_CLOSE_DAYS * 864e5).toISOString(),
    })
    .eq('id', prof.id);

  if (isTransactionalMailConfigured()) {
    await dispatchEmail(admin, {
      type: 'account_archived',
      recipientProfileId: prof.id,
    });
  }

  return jsonResponse({ ok: true }, req);
});
