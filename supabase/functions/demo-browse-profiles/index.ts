import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
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

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: requesterProfile, error: requesterErr } = await admin
    .from('profiles')
    .select('status, membership_expires_at')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (requesterErr) {
    return jsonResponse({ error: requesterErr.message }, req, 500);
  }

  const hasActiveMembership =
    requesterProfile?.status === 'active' &&
    !!requesterProfile.membership_expires_at &&
    new Date(requesterProfile.membership_expires_at) > new Date();

  if (!isUserAdmin(userData.user) && !hasActiveMembership) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }

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

  const profiles = (data ?? []).map((p) => ({
    id: p.id,
    demo_label: `Member ${String(p.id).slice(0, 6).toUpperCase()}`,
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
