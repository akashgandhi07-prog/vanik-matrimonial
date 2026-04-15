import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured' }, req, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data, error } = await admin
    .from('profiles')
    .select(
      'id, reference_number, first_name, age, created_at, job_title, height_cm, diet, religion, community, nationality'
    )
    .eq('status', 'active')
    .eq('show_on_register', true)
    .not('membership_expires_at', 'is', null)
    .gt('membership_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    return jsonResponse({ error: error.message }, req, 500);
  }

  return jsonResponse({ ok: true, profiles: data ?? [] }, req);
});
