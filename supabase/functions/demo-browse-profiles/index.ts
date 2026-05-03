import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { allowFunctionRateLimit, clientIp } from '../_shared/function-rate-limit.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { stripHtml } from '../_shared/sanitize.ts';

/** Per-IP cap; members use RLS, guests get the public register slice via service role. */
const DEMO_BROWSE_LIMIT = { maxAttempts: 100, windowMs: 60 * 60 * 1000 };
const ROW_CAP = 150;

const PROFILE_COLUMNS =
  'age, created_at, job_title, height_cm, diet, religion, nationality, place_of_birth, gender';

type ProfileRow = Record<string, unknown>;

function mapToDemoProfiles(profiles: ProfileRow[] | null) {
  return (profiles ?? []).map((p, index) => ({
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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anon || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured' }, req, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized', code: 'auth_required' }, req, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const ip = clientIp(req);
  const okLimit = await allowFunctionRateLimit(admin, {
    scope: 'demo-browse-profiles',
    rateKey: ip.slice(0, 256),
    maxAttempts: DEMO_BROWSE_LIMIT.maxAttempts,
    windowMs: DEMO_BROWSE_LIMIT.windowMs,
  });
  if (!okLimit) {
    return jsonResponse(
      { error: 'Too many requests. Try again later.', code: 'rate_limited' },
      req,
      429
    );
  }

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const authedUser = !userErr && userData.user ? userData.user : null;

  if (authedUser && isUserAdmin(authedUser)) {
    return jsonResponse({ ok: true, profiles: [], demo_unavailable_for_admin: true }, req);
  }

  const isAnonymous =
    authedUser != null && (authedUser as { is_anonymous?: boolean }).is_anonymous === true;
  const useGuestCatalog = !authedUser || isAnonymous;

  if (useGuestCatalog) {
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('status', 'active')
      .eq('show_on_register', true)
      .eq('browse_paused', false)
      .not('membership_expires_at', 'is', null)
      .gt('membership_expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP);

    if (error) {
      console.error('demo-browse-profiles (guest):', error.message);
      return jsonResponse({ error: 'Could not load profiles' }, req, 500);
    }

    return jsonResponse({ ok: true, profiles: mapToDemoProfiles(data as ProfileRow[] | null) }, req);
  }

  const { data, error } = await userClient
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(ROW_CAP);

  if (error) {
    console.error('demo-browse-profiles:', error.message);
    return jsonResponse({ error: 'Could not load profiles' }, req, 500);
  }

  return jsonResponse({ ok: true, profiles: mapToDemoProfiles(data as ProfileRow[] | null) }, req);
});
