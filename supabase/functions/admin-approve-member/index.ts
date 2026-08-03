import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isSupportAdmin, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmailInBackground, getAdminClient } from '../_shared/dispatch-email.ts';
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
    .select('id_document_url, coupon_used, referred_by_code')
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

  // Recommend-a-friend: if this member was referred, the friend bonus (+1 month)
  // stacks on top of whatever coupon/payment granted, and the referrer earns
  // +2 months when we finish the approval below. The UNIQUE constraint on
  // referrals.referred_profile_id makes a re-approval award nothing twice.
  const REFERRED_BONUS_MONTHS = 1;
  const REFERRER_REWARD_MONTHS = 2;
  type ReferrerInfo = {
    profileId: string;
    status: string;
    membershipExpiresAt: string | null;
  };
  let referrer: ReferrerInfo | null = null;
  const referredByCode = (priv.referred_by_code as string | null)?.trim() || null;
  let referralAlreadyRewarded = false;
  if (referredByCode) {
    const { data: existingReferral } = await admin
      .from('referrals')
      .select('id')
      .eq('referred_profile_id', profileId)
      .maybeSingle();
    referralAlreadyRewarded = !!existingReferral;
    if (!referralAlreadyRewarded) {
      // referred_by_code is stored verbatim from member_private.referral_code at
      // submission time, so an exact match is correct here.
      const { data: refPriv } = await admin
        .from('member_private')
        .select('profile_id')
        .eq('referral_code', referredByCode)
        .maybeSingle();
      if (refPriv && (refPriv.profile_id as string) !== profileId) {
        const { data: refProf } = await admin
          .from('profiles')
          .select('id, status, membership_expires_at')
          .eq('id', refPriv.profile_id as string)
          .maybeSingle();
        if (refProf) {
          referrer = {
            profileId: refProf.id as string,
            status: String(refProf.status),
            membershipExpiresAt: refProf.membership_expires_at as string | null,
          };
        }
      }
      if (referrer) {
        expires = addMonths(expires, REFERRED_BONUS_MONTHS);
      }
    }
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
      hidden_reason: null,
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
        (couponFreeMonths != null ? ` (${couponFreeMonths} months free via coupon ${couponCode})` : '') +
        (referrer ? ` (+${REFERRED_BONUS_MONTHS} month referral bonus, code ${referredByCode})` : ''),
      500
    ),
  });

  if (referrer && referredByCode) {
    const eligible = referrer.status === 'active';
    let rewardNote = eligible ? null : `referrer status '${referrer.status}' - no reward`;
    let referrerMonths: number | null = null;
    let newReferrerExpiry: Date | null = null;

    if (eligible) {
      // Extend from the later of now / current expiry: a lapsed-but-active
      // referrer is revived with 2 months from today.
      const now = new Date();
      const currentExp = referrer.membershipExpiresAt ? new Date(referrer.membershipExpiresAt) : now;
      const base = currentExp > now ? currentExp : now;
      newReferrerExpiry = addMonths(base, REFERRER_REWARD_MONTHS);
      const { error: extErr } = await admin
        .from('profiles')
        .update({ membership_expires_at: newReferrerExpiry.toISOString() })
        .eq('id', referrer.profileId);
      if (extErr) {
        console.error('referral reward: extend referrer membership failed', extErr.message);
        rewardNote = `extend failed: ${extErr.message}`.slice(0, 300);
        newReferrerExpiry = null;
      } else {
        referrerMonths = REFERRER_REWARD_MONTHS;
      }
    }

    const { error: refInsErr } = await admin.from('referrals').insert({
      referrer_profile_id: referrer.profileId,
      referred_profile_id: profileId,
      code_used: referredByCode,
      referrer_months: referrerMonths,
      referred_months: REFERRED_BONUS_MONTHS,
      rewarded_at: referrerMonths != null ? new Date().toISOString() : null,
      reward_note: rewardNote,
    });
    if (refInsErr) {
      // Unique violation = concurrent double-approval already rewarded; anything
      // else is logged but never fails the approval itself.
      console.error('referral reward: referrals insert', refInsErr.message);
    } else if (referrerMonths != null && newReferrerExpiry) {
      await admin.from('admin_actions').insert({
        admin_user_id: userData.user.id,
        target_profile_id: referrer.profileId,
        action_type: 'referral_reward',
        notes: stripHtml(
          `+${referrerMonths} months for referring an accepted member (code ${referredByCode}). Membership now until ${newReferrerExpiry.toISOString().slice(0, 10)}.`,
          500
        ),
      });
      if (isTransactionalMailConfigured()) {
        const { data: friendProf } = await admin
          .from('profiles')
          .select('first_name')
          .eq('id', profileId)
          .maybeSingle();
        dispatchEmailInBackground(admin, {
          type: 'referral_reward',
          recipientProfileId: referrer.profileId,
          extraData: {
            friend_first_name: friendProf?.first_name ?? '',
            months: referrerMonths,
            new_expiry: newReferrerExpiry.toISOString(),
          },
        });
      }
    }
  }

  // Email goes out after the response: the approval is already committed, and
  // a mail failure must never surface as an error for an action that worked.
  if (isTransactionalMailConfigured()) {
    dispatchEmailInBackground(admin, {
      type: 'registration_approved',
      recipientProfileId: profileId,
    });
  }

  return jsonResponse({ ok: true, reference_number: ref }, req);
});
