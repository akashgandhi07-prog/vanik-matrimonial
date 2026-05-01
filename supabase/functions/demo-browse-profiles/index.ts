import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { stripHtml } from '../_shared/sanitize.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured' }, req, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const bearer = authHeader.slice(7).trim();
  /**
   * Public browse preview: no names, photos, or contact data — same shape as the logged-in teaser.
   * Allow the project's anon key (how `invokePublicFunction` calls) or any valid user session JWT.
   */
  const publicAnonCall = bearer === anonKey;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (!publicAnonCall && (userErr || !userData.user)) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin
    .from('profiles')
    .select(
      'id, age, created_at, job_title, height_cm, diet, religion, nationality, place_of_birth, gender'
    )
    .eq('status', 'active')
    .eq('show_on_register', true)
    .not('membership_expires_at', 'is', null)
    .gt('membership_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    return jsonResponse({ error: error.message }, req, 500);
  }

  const profiles = (data ?? []).map((p, index) => ({
    demo_id: `demo-${index + 1}`,
    demo_label: `Member ${index + 1}`,
    age: p.age,
    created_at: p.created_at,
    job_title: stripHtml(p.job_title ?? '', 120),
    height_cm: p.height_cm,
    diet: stripHtml(p.diet ?? '', 40),
    religion: stripHtml(p.religion ?? '', 40),
    nationality: stripHtml(p.nationality ?? '', 60),
    place_of_birth: stripHtml(p.place_of_birth ?? '', 80),
    gender: stripHtml(p.gender ?? '', 20),
  }));

  return jsonResponse({ ok: true, profiles }, req);
});
