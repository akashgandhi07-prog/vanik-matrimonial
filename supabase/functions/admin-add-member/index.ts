import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

function isUserAdmin(user: { user_metadata?: unknown; app_metadata?: unknown }) {
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const a = user.app_metadata as Record<string, unknown> | undefined;
  return m?.is_admin === true || a?.is_admin === true;
}

function randomPassword(len = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) {
    return jsonResponse({ error: 'email is required' }, 400);
  }
  const firstName = String(body.first_name ?? '').trim();
  if (!firstName) {
    return jsonResponse({ error: 'first_name is required' }, 400);
  }

  // 1. Create auth user
  const password = randomPassword();
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authData.user) {
    return jsonResponse({ error: authErr?.message ?? 'Failed to create auth user' }, 500);
  }
  const userId = authData.user.id;

  const status = String(body.status ?? 'active');
  const membershipExpiresAt = body.membership_expires_at
    ? String(body.membership_expires_at)
    : null;
  const showOnRegister = body.show_on_register === true || body.show_on_register === 'true';

  // 2. Insert into profiles
  const { data: profileData, error: profileErr } = await admin
    .from('profiles')
    .insert({
      id: userId,
      first_name: firstName,
      gender: String(body.gender ?? 'Male'),
      status,
      community: body.community ? String(body.community) : null,
      religion: body.religion ? String(body.religion) : null,
      nationality: body.nationality ? String(body.nationality) : null,
      place_of_birth: body.place_of_birth ? String(body.place_of_birth) : null,
      town_of_origin: body.town_of_origin ? String(body.town_of_origin) : null,
      education: body.education ? String(body.education) : null,
      job_title: body.job_title ? String(body.job_title) : null,
      height_cm: body.height_cm != null ? Number(body.height_cm) : null,
      diet: body.diet ? String(body.diet) : null,
      hobbies: body.hobbies ? String(body.hobbies) : null,
      future_settlement_plans: body.future_settlement_plans ? String(body.future_settlement_plans) : null,
      father_name: body.father_name ? String(body.father_name) : null,
      mother_name: body.mother_name ? String(body.mother_name) : null,
      membership_expires_at: membershipExpiresAt,
      show_on_register: showOnRegister,
    })
    .select('id')
    .single();

  if (profileErr || !profileData) {
    // Cleanup auth user on failure
    await admin.auth.admin.deleteUser(userId);
    return jsonResponse({ error: profileErr?.message ?? 'Failed to create profile' }, 500);
  }

  const profileId = profileData.id as string;

  // 3. Insert into member_private
  const { error: privateErr } = await admin.from('member_private').insert({
    profile_id: profileId,
    email,
    mobile_phone: body.mobile_phone ? String(body.mobile_phone) : null,
    date_of_birth: body.date_of_birth ? String(body.date_of_birth) : null,
    surname: body.surname ? String(body.surname) : null,
    home_address_line1: body.home_address_line1 ? String(body.home_address_line1) : null,
    city: body.city ? String(body.city) : null,
    postcode: body.postcode ? String(body.postcode) : null,
    country: body.country ? String(body.country) : 'UK',
  });

  if (privateErr) {
    // Non-fatal — profile is created, just log it
    console.error('member_private insert error:', privateErr.message);
  }

  // 4. Assign reference number if status is active
  let referenceNumber: string | null = null;
  if (status === 'active') {
    const { data: refData } = await admin.rpc('assign_next_reference_number', {
      p_profile_id: profileId,
    });
    referenceNumber = refData as string | null;
  }

  return jsonResponse({ ok: true, profile_id: profileId, reference_number: referenceNumber });
});
