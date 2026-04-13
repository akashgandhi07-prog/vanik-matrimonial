import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { sendResendEmail, letterHtml } from '../_shared/resend.ts';
import { stripHtml } from '../_shared/sanitize.ts';
import { verifyPaidCheckoutSession } from '../_shared/stripe.ts';

async function checkRateLimit(
  admin: ReturnType<typeof getAdminClient>,
  ip: string
): Promise<boolean> {
  const now = new Date();
  const { data: row } = await admin
    .from('registration_rate_limits')
    .select('*')
    .eq('ip', ip)
    .maybeSingle();

  if (!row) {
    await admin.from('registration_rate_limits').insert({
      ip,
      attempt_count: 1,
      window_started_at: now.toISOString(),
    });
    return true;
  }

  const start = new Date(row.window_started_at);
  if (now.getTime() - start.getTime() > 60 * 60 * 1000) {
    await admin
      .from('registration_rate_limits')
      .update({ attempt_count: 1, window_started_at: now.toISOString() })
      .eq('ip', ip);
    return true;
  }

  if (row.attempt_count >= 3) return false;

  await admin
    .from('registration_rate_limits')
    .update({ attempt_count: row.attempt_count + 1 })
    .eq('ip', ip);
  return true;
}

function pathExtensionOk(path: string, kind: 'photo' | 'id'): boolean {
  const lower = path.toLowerCase();
  if (kind === 'photo') {
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
  }
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.pdf')
  );
}

async function verifyObjectExists(
  admin: ReturnType<typeof getAdminClient>,
  bucket: string,
  path: string
): Promise<boolean> {
  const parts = path.split('/');
  const name = parts.pop();
  const folder = parts.join('/');
  if (!name) return false;
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 200 });
  if (error || !data?.length) return false;
  return data.some((o) => o.name === name);
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
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.email) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = (forwarded?.split(',')[0] ?? req.headers.get('cf-connecting-ip') ?? 'unknown').trim();

  const admin = getAdminClient();
  const okLimit = await checkRateLimit(admin, ip);
  if (!okLimit) {
    return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (existing) {
    return jsonResponse({ error: 'Profile already exists' }, 400);
  }

  const gender = body.gender === 'Female' ? 'Female' : 'Male';
  const photoPath = String(body.photo_path ?? '');
  const idPath = String(body.id_document_path ?? '');
  if (!photoPath || !idPath) {
    return jsonResponse({ error: 'Files required' }, 400);
  }

  if (!pathExtensionOk(photoPath, 'photo') || !pathExtensionOk(idPath, 'id')) {
    return jsonResponse({ error: 'Invalid file type' }, 400);
  }
  const photoOk = await verifyObjectExists(admin, 'profile-photos', photoPath);
  const idOk = await verifyObjectExists(admin, 'id-documents', idPath);
  if (!photoOk || !idOk) {
    return jsonResponse({ error: 'Upload not found' }, 400);
  }

  const couponRaw = stripHtml(String(body.coupon_code ?? ''), 32).toUpperCase();
  let couponValid = false;
  if (couponRaw) {
    const { data: c } = await admin
      .from('coupons')
      .select('*')
      .eq('code', couponRaw)
      .maybeSingle();
    const now = new Date();
    if (
      c?.is_active &&
      (!c.expires_at || new Date(c.expires_at) > now) &&
      (c.max_uses == null || c.use_count < c.max_uses)
    ) {
      couponValid = true;
    }
  }

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const paymentRequired = !!stripeSecret && !couponValid;
  let stripeCheckoutSessionId: string | null = null;
  if (paymentRequired) {
    const sid = stripHtml(String(body.stripe_checkout_session_id ?? ''), 128);
    if (!sid.startsWith('cs_')) {
      return jsonResponse(
        {
          error: 'Membership fee payment is required before submitting your registration.',
          code: 'PAYMENT_REQUIRED',
        },
        402
      );
    }
    try {
      await verifyPaidCheckoutSession({
        secretKey: stripeSecret,
        sessionId: sid,
        authUserId: userData.user.id,
        purpose: 'registration',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment verification failed';
      return jsonResponse({ error: msg }, 400);
    }
    stripeCheckoutSessionId = sid;
  }

  const firstName = stripHtml(String(body.first_name ?? ''), 80);
  const surname = stripHtml(String(body.surname ?? ''), 80);
  const email = stripHtml(String(body.email ?? userData.user.email), 120);
  const mobile = stripHtml(String(body.mobile_phone ?? ''), 40);
  const dob = String(body.date_of_birth ?? '');

  const profileRow = {
    gender,
    first_name: firstName,
    education: stripHtml(String(body.education ?? ''), 500),
    job_title: stripHtml(String(body.job_title ?? ''), 200),
    height_cm: Number(body.height_cm) || null,
    weight_kg: body.weight_kg != null ? Number(body.weight_kg) : null,
    diet: body.diet as string,
    religion: body.religion as string,
    community: body.community as string,
    nationality: stripHtml(String(body.nationality ?? ''), 100),
    place_of_birth: stripHtml(String(body.place_of_birth ?? ''), 200),
    town_country_of_origin: stripHtml(String(body.town_country_of_origin ?? ''), 200),
    future_settlement_plans: stripHtml(String(body.future_settlement_plans ?? ''), 200),
    hobbies: stripHtml(String(body.hobbies ?? ''), 400),
    photo_url: photoPath,
    photo_status: 'pending',
    status: 'pending_approval',
    auth_user_id: userData.user.id,
  };

  const { data: insProfile, error: pErr } = await admin
    .from('profiles')
    .insert(profileRow)
    .select('id')
    .single();

  if (pErr || !insProfile) {
    return jsonResponse({ error: pErr?.message ?? 'Insert failed' }, 500);
  }

  const profileId = insProfile.id as string;

  const privateRow = {
    profile_id: profileId,
    surname,
    date_of_birth: dob,
    email,
    mobile_phone: mobile,
    home_address_line1: stripHtml(String(body.home_address_line1 ?? ''), 200),
    home_address_city: stripHtml(String(body.home_address_city ?? ''), 100),
    home_address_postcode: stripHtml(String(body.home_address_postcode ?? ''), 20),
    home_address_country: stripHtml(String(body.home_address_country ?? 'UK'), 80),
    father_name: stripHtml(String(body.father_name ?? ''), 120),
    mother_name: stripHtml(String(body.mother_name ?? ''), 120),
    id_document_url: idPath,
    coupon_used: couponValid ? couponRaw : null,
  };

  const { error: mErr } = await admin.from('member_private').insert(privateRow);
  if (mErr) {
    await admin.from('profiles').delete().eq('id', profileId);
    return jsonResponse({ error: mErr.message }, 500);
  }

  const { data: refResult, error: refErr } = await admin.rpc('assign_next_reference_number', {
    p_profile_id: profileId,
    p_gender: gender,
  });

  if (refErr) {
    return jsonResponse({ error: refErr.message }, 500);
  }

  const referenceNumber = refResult as string;

  if (couponValid) {
    const { data: cur } = await admin.from('coupons').select('use_count').eq('code', couponRaw).single();
    if (cur) {
      await admin
        .from('coupons')
        .update({ use_count: (cur.use_count ?? 0) + 1 })
        .eq('code', couponRaw);
    }
  }

  if (stripeCheckoutSessionId) {
    await admin.from('stripe_checkout_sessions').upsert(
      {
        checkout_session_id: stripeCheckoutSessionId,
        auth_user_id: userData.user.id,
        profile_id: profileId,
        purpose: 'registration',
        payment_status: 'paid',
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'checkout_session_id' }
    );
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    await dispatchEmail(admin, resendKey, {
      type: 'registration_received',
      recipientProfileId: profileId,
      extra_data: {
        first_name: firstName,
        reference_number: referenceNumber,
      },
    });

    const notify = Deno.env.get('ADMIN_NOTIFY_EMAIL') ?? 'register@vanikmatrimonial.co.uk';
    const html = letterHtml(
      'New registration',
      `<p>A new matrimonial registration was submitted.</p>
       <p><strong>Reference:</strong> ${stripHtml(referenceNumber, 20)}<br/>
       <strong>Name:</strong> ${firstName} ${surname}<br/>
       <strong>Email:</strong> ${email}</p>
       <p><a href="${Deno.env.get('PUBLIC_SITE_URL') ?? ''}/admin/members/${profileId}">Review in admin</a></p>`
    );
    await sendResendEmail(resendKey, {
      to: notify,
      subject: 'New Vanik Matrimonial registration',
      html,
    });
  }

  return jsonResponse({
    ok: true,
    profile_id: profileId,
    reference_number: referenceNumber,
  });
});
