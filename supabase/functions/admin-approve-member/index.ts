import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { isTransactionalMailConfigured } from '../_shared/transactional-mail.ts';
import { stripHtml } from '../_shared/sanitize.ts';

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
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }
  if (isSupportAdmin(userData.user)) {
    return jsonResponse({ error: 'Support admin role cannot approve applications' }, req, 403);
  }

  let body: { profile_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }
  const profileId = body.profile_id;
  if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);

  const admin = getAdminClient();

  const { data: priv, error: pe } = await admin
    .from('member_private')
    .select('id_document_url, coupon_used')
    .eq('profile_id', profileId)
    .single();
  if (pe || !priv) {
    return jsonResponse({ error: 'Member not found' }, req, 404);
  }

  const idPath = priv.id_document_url as string | null;
  if (idPath) {
    const { error: remErr } = await admin.storage.from('id-documents').remove([idPath]);
    if (remErr) {
      return jsonResponse({ error: `ID document delete failed: ${remErr.message}` }, req, 500);
    }
  }

  const { error: upPriv } = await admin
    .from('member_private')
    .update({
      id_document_url: null,
      id_document_deleted_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId);
  if (upPriv) {
    return jsonResponse({ error: upPriv.message }, req, 500);
  }

  function addMonths(from: Date, months: number): Date {
    const d = new Date(from);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // Clamp to the target month's last day (e.g. 31 Jan + 1 month -> 28/29 Feb)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
  }
  function addOneYear(from: Date): Date {
    return addMonths(from, 12);
  }

  const { data: prof, error: profFetchErr } = await admin
    .from('profiles')
    .select('reference_number, gender, auth_user_id')
    .eq('id', profileId)
    .single();
  if (profFetchErr || !prof) {
    return jsonResponse({ error: 'Member profile not found' }, req, 404);
  }

  const { data: paidReg } = await admin
    .from('stripe_checkout_sessions')
    .select('updated_at, created_at')
    .eq('auth_user_id', prof.auth_user_id as string)
    .eq('purpose', 'registration')
    .eq('payment_status', 'paid')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Free coupons may grant a limited duration (coupons.free_months);
  // paid registrations always get the standard 12 months.
  let couponFreeMonths: number | null = null;
  const couponCode = priv.coupon_used as string | null;
  if (couponCode) {
    const { data: cRow } = await admin
      .from('coupons')
      .select('type, free_months')
      .eq('code', couponCode)
      .maybeSingle();
    const months = cRow?.free_months;
    if (cRow?.type === 'free' && typeof months === 'number' && months >= 1) {
      couponFreeMonths = Math.floor(months);
    }
  }

  let expires: Date;
  if (paidReg) {
    const raw = (paidReg.updated_at ?? paidReg.created_at) as string;
    const paidAt = new Date(raw);
    expires = addOneYear(paidAt);
    const now = new Date();
    if (expires <= now) {
      expires = addOneYear(now);
    }
  } else if (couponFreeMonths != null) {
    expires = addMonths(new Date(), couponFreeMonths);
  } else {
    expires = addOneYear(new Date());
  }

  let ref = prof.reference_number as string | null;
  if (!ref && prof.gender) {
    const { data: r, error: re } = await admin.rpc('assign_next_reference_number', {
      p_profile_id: profileId,
      p_gender: prof.gender,
    });
    if (re) return jsonResponse({ error: re.message }, req, 500);
    ref = r as string;
  }

  const { error: upProf } = await admin
    .from('profiles')
    .update({
      status: 'active',
      membership_expires_at: expires.toISOString(),
      photo_status: 'approved',
      show_on_register: true,
    })
    .eq('id', profileId);
  if (upProf) {
    return jsonResponse({ error: upProf.message }, req, 500);
  }

  await admin.from('admin_actions').insert({
    admin_user_id: userData.user.id,
    target_profile_id: profileId,
    action_type: 'approved',
    notes: stripHtml(
      `Approved. Membership until ${expires.toISOString().slice(0, 10)}` +
        (couponFreeMonths != null ? ` (${couponFreeMonths} months free via coupon ${couponCode})` : ''),
      500
    ),
  });

  if (isTransactionalMailConfigured()) {
    await dispatchEmail(admin, {
      type: 'registration_approved',
      recipientProfileId: profileId,
    });
  }

  return jsonResponse({ ok: true, reference_number: ref }, req);
});
