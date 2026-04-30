import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
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

  const admin = getAdminClient();
  const { data: prof } = await admin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', userData.user.id)
    .single();
  if (!prof) {
    return jsonResponse({ error: 'No profile' }, req, 400);
  }

  await admin
    .from('profiles')
    .update({ status: 'archived', show_on_register: false })
    .eq('id', prof.id);

  if (isTransactionalMailConfigured()) {
    await dispatchEmail(admin, {
      type: 'account_archived',
      recipientProfileId: prof.id,
    });
  }

  return jsonResponse({ ok: true }, req);
});
