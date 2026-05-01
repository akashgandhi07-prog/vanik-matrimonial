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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured' }, req, 500);
  }

  /**
   * Public browse preview only (fields below are sanitized). `verify_jwt` is false for this function.
   * No in-handler auth: the SPA already ships the anon key; strict Bearer/anon matching returned 401
   * when hosting env keys drifted from the Supabase project or proxies dropped `Authorization`.
   */
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
