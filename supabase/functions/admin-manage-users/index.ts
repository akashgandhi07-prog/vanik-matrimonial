import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { adminPowerRole, isSupportAdmin, metaIsAdminFlag, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, type EmailType } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

function siteUrlFromEnv(): string {
  return Deno.env.get('PUBLIC_SITE_URL') ?? 'https://vanikmatrimonial.co.uk';
}

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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }

  const callerId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'list_profiles') {
    const f = typeof body.filter === 'string' ? body.filter : 'all';
    const lapseCutoff = new Date(Date.now() - 90 * 864e5).toISOString();
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const nowIso = new Date().toISOString();
    const expires60Until = new Date(Date.now() + 60 * 864e5).toISOString();

    let q = admin.from('profiles').select('*');
    if (f === 'pending') q = q.eq('status', 'pending_approval');
    else if (f === 'active') q = q.eq('status', 'active');
    else if (f === 'expired') q = q.eq('status', 'expired');
    else if (f === 'rejected') q = q.eq('status', 'rejected');
    else if (f === 'archived') q = q.eq('status', 'archived');
    else if (f === 'matched') q = q.eq('status', 'matched');
    else if (f === 'lapsed90') {
      q = q.eq('status', 'expired').lt('membership_expires_at', lapseCutoff);
    } else if (f === 'rejected30') {
      q = q.eq('status', 'rejected').gte('updated_at', since30);
    } else if (f === 'photo_pending') {
      q = q.not('pending_photo_url', 'is', null);
    } else if (f === 'expires60') {
      q = q
        .eq('status', 'active')
        .not('membership_expires_at', 'is', null)
        .gte('membership_expires_at', nowIso)
        .lte('membership_expires_at', expires60Until);
    } else if (f !== 'all') {
      return jsonResponse({ error: 'Invalid filter' }, req, 400);
    }

    if (f === 'pending') q = q.order('created_at', { ascending: true });
    else q = q.order('created_at', { ascending: false });
    const { data: profiles, error: pErr } = await q;
    if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
    const rows = profiles ?? [];
    const emails: Record<string, string> = {};
    let pendingPreviews:
      | Record<string, { photo: string | null; id_document: string | null; id_is_image: boolean }>
      | undefined;
    if (rows.length > 0) {
      const ids = rows.map((p: { id: string }) => p.id);
      const { data: priv, error: mErr } = await admin
        .from('member_private')
        .select('profile_id, email, id_document_url')
        .in('profile_id', ids);
      if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
      const idDocByProfile = new Map<string, string | null>();
      for (const r of priv ?? []) {
        const row = r as { profile_id: string; email: string | null; id_document_url: string | null };
        if (row.profile_id) {
          emails[row.profile_id] = row.email ?? '';
          idDocByProfile.set(row.profile_id, row.id_document_url ?? null);
        }
      }
      if (f === 'pending') {
        pendingPreviews = {};
        const ttl = 1800;
        for (const p of rows as { id: string; photo_url: string | null }[]) {
          let photoSigned: string | null = null;
          let idSigned: string | null = null;
          if (p.photo_url) {
            const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(p.photo_url, ttl);
            photoSigned = s?.signedUrl ?? null;
          }
          const idPath = idDocByProfile.get(p.id) ?? '';
          const idLower = idPath.toLowerCase();
          const idIsImage =
            idLower.endsWith('.jpg') || idLower.endsWith('.jpeg') || idLower.endsWith('.png');
          if (idPath) {
            const { data: s } = await admin.storage.from('id-documents').createSignedUrl(idPath, ttl);
            idSigned = s?.signedUrl ?? null;
          }
          pendingPreviews[p.id] = {
            photo: photoSigned,
            id_document: idSigned,
            id_is_image: idIsImage,
          };
        }
      }
    }
    return jsonResponse({ profiles: rows, emails, pending_previews: pendingPreviews }, req);
  }

  if (action === 'list') {
    const users: Array<{
      id: string;
      email: string | undefined;
      is_admin: boolean;
      admin_role: 'super' | 'support' | null;
      created_at: string;
    }> = [];
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ error: error.message }, req, 500);
      const batch = data?.users ?? [];
      for (const u of batch) {
        const am = u.app_metadata as Record<string, unknown> | undefined;
        const adminFlag = metaIsAdminFlag(am?.is_admin);
        const ar = am?.admin_role === 'support' ? 'support' : am?.admin_role === 'super' ? 'super' : null;
        users.push({
          id: u.id,
          email: u.email,
          is_admin: adminFlag,
          admin_role: adminFlag ? (ar ?? 'super') : null,
          created_at: u.created_at,
        });
      }
      if (batch.length < perPage) break;
      page++;
    }
    users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    return jsonResponse({ users }, req);
  }

  if (action === 'overview_metrics') {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const monthEnd = new Date();
    monthEnd.setDate(monthEnd.getDate() + 30);
    const lapseCutoff = new Date(Date.now() - 90 * 864e5).toISOString();
    const nowIso = new Date().toISOString();

    const [
      pending,
      requestsWeek,
      expiring,
      flagged,
      lapsed90,
      actRes,
      activeMembers,
      photoPendingReview,
      paidRegSessions,
    ] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
      admin.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('membership_expires_at', monthEnd.toISOString())
        .gte('membership_expires_at', nowIso),
      admin.from('feedback').select('id', { count: 'exact', head: true }).eq('is_flagged', true),
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'expired')
        .lt('membership_expires_at', lapseCutoff),
      admin
        .from('admin_actions')
        .select('id, action_type, created_at, notes')
        .order('created_at', { ascending: false })
        .limit(20),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).not('pending_photo_url', 'is', null),
      admin
        .from('stripe_checkout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('purpose', 'registration')
        .eq('payment_status', 'paid'),
    ]);

    const errors = [
      pending.error,
      requestsWeek.error,
      expiring.error,
      flagged.error,
      lapsed90.error,
      actRes.error,
      activeMembers.error,
      photoPendingReview.error,
      paidRegSessions.error,
    ]
      .filter(Boolean)
      .map((e) => e!.message);
    if (errors.length) {
      return jsonResponse({ error: [...new Set(errors)].join(' ') }, req, 500);
    }

    return jsonResponse({
      metrics: {
        pending: pending.count ?? 0,
        requestsWeek: requestsWeek.count ?? 0,
        expiring: expiring.count ?? 0,
        flagged: flagged.count ?? 0,
        lapsed90: lapsed90.count ?? 0,
        activeMembers: activeMembers.count ?? 0,
        photoPendingReview: photoPendingReview.count ?? 0,
        paidRegistrationSessions: paidRegSessions.count ?? 0,
      },
      actions: actRes.data ?? [],
      caller_role: adminPowerRole(userData.user),
    }, req);
  }

  if (action === 'list_requests') {
    const page = typeof body.page === 'number' && body.page >= 1 ? Math.floor(body.page) : 1;
    const pageSize =
      typeof body.page_size === 'number' && body.page_size >= 1 && body.page_size <= 200
        ? Math.floor(body.page_size)
        : 50;
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    const { data: requestRows, error: rErr } = await admin
      .from('requests')
      .select('id, created_at, requester_id, candidate_ids')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (rErr) return jsonResponse({ error: rErr.message }, req, 500);

    const rows = requestRows ?? [];
    const idSet = new Set<string>();
    for (const r of rows as { requester_id?: string; candidate_ids?: string[] }[]) {
      if (r.requester_id) idSet.add(r.requester_id);
      for (const c of r.candidate_ids ?? []) idSet.add(c);
    }
    const names: Record<string, string> = {};
    if (idSet.size > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number')
        .in('id', [...idSet]);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as { id: string; first_name: string; reference_number: string | null };
        names[row.id] = `${row.first_name} (${row.reference_number ?? '-'})`;
      }
    }
    return jsonResponse({ requests: rows, names }, req);
  }

  if (action === 'list_feedback') {
    const { data: fb, error: fErr } = await admin
      .from('feedback')
      .select(
        'id, request_id, candidate_id, requester_id, made_contact, recommend_retain, notes, is_flagged, submitted_at'
      )
      .order('submitted_at', { ascending: false });
    if (fErr) return jsonResponse({ error: fErr.message }, req, 500);
    const feedbackRows = fb ?? [];
    const candidateIds = [...new Set((feedbackRows as { candidate_id: string }[]).map((r) => r.candidate_id))];
    const profiles: Record<string, { id: string; first_name: string; reference_number: string | null }> = {};
    if (candidateIds.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number')
        .in('id', candidateIds);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as { id: string; first_name: string; reference_number: string | null };
        profiles[row.id] = row;
      }
    }
    return jsonResponse({ feedback: feedbackRows, profiles }, req);
  }

  if (action === 'settings_stats') {
    const statuses = [
      'pending_approval',
      'active',
      'expired',
      'rejected',
      'archived',
      'matched',
    ] as const;
    const countPromises = statuses.map((s) =>
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', s)
    );
    const [counts, reqC, fbC, emailAttempted, emailOk] = await Promise.all([
      Promise.all(countPromises),
      admin.from('requests').select('id', { count: 'exact', head: true }),
      admin.from('feedback').select('id', { count: 'exact', head: true }),
      admin.from('email_log').select('id', { count: 'exact', head: true }).not('resend_message_id', 'is', null),
      admin.from('email_log').select('id', { count: 'exact', head: true }).in('status', ['sent', 'delivered']),
    ]);

    for (const c of counts) {
      if (c.error) return jsonResponse({ error: c.error.message }, req, 500);
    }
    if (reqC.error) return jsonResponse({ error: reqC.error.message }, req, 500);
    if (fbC.error) return jsonResponse({ error: fbC.error.message }, req, 500);
    if (emailAttempted.error) return jsonResponse({ error: emailAttempted.error.message }, req, 500);
    if (emailOk.error) return jsonResponse({ error: emailOk.error.message }, req, 500);

    const byStatus: Record<string, number> = {};
    statuses.forEach((s, i) => {
      byStatus[s] = counts[i].count ?? 0;
    });
    return jsonResponse({
      byStatus,
      requests: reqC.count ?? 0,
      feedback: fbC.count ?? 0,
      emailAttempted: emailAttempted.count ?? 0,
      emailOk: emailOk.count ?? 0,
    }, req);
  }

  if (action === 'update_member_record') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot edit member records' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);

    const profIn = body.profile as Record<string, unknown> | undefined;
    const privIn = body.member_private as Record<string, unknown> | undefined;
    if (!profIn && !privIn) {
      return jsonResponse({ error: 'Provide profile and/or member_private fields to update' }, req, 400);
    }

    const { data: profRow, error: profErr } = await admin
      .from('profiles')
      .select('id, auth_user_id')
      .eq('id', profileId)
      .single();
    if (profErr || !profRow) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const authUserId = profRow.auth_user_id as string;

    const { data: beforeProf } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: beforePriv } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();

    let previousMemberEmail = '';
    if (privIn && privIn.email !== undefined) {
      const { data: mp0 } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
      previousMemberEmail = (mp0?.email as string) ?? '';
    }

    if (privIn && privIn.email !== undefined) {
      const newEmail = stripHtml(String(privIn.email), 120);
      if (!newEmail) {
        return jsonResponse({ error: 'Email cannot be empty' }, req, 400);
      }
      if (newEmail !== previousMemberEmail) {
        const { error: aErr } = await admin.auth.admin.updateUserById(authUserId, { email: newEmail });
        if (aErr) {
          return jsonResponse({ error: `Could not update login email: ${aErr.message}` }, req, 400);
        }
      }
    }

    const profilePatch: Record<string, unknown> = {};
    if (profIn) {
      if (profIn.gender !== undefined) {
        const g = String(profIn.gender);
        if (g !== 'Male' && g !== 'Female') {
          return jsonResponse({ error: 'gender must be Male or Female' }, req, 400);
        }
        profilePatch.gender = g;
      }
      if (profIn.seeking_gender !== undefined) {
        const sg = String(profIn.seeking_gender);
        if (sg !== 'Male' && sg !== 'Female' && sg !== 'Both') {
          return jsonResponse({ error: 'seeking_gender must be Male, Female, or Both' }, req, 400);
        }
        profilePatch.seeking_gender = sg;
      }
      if (profIn.first_name !== undefined) {
        const fn = stripHtml(String(profIn.first_name), 80);
        if (!fn) return jsonResponse({ error: 'first_name cannot be empty' }, req, 400);
        profilePatch.first_name = fn;
      }
      if (profIn.education !== undefined) profilePatch.education = stripHtml(String(profIn.education), 500);
      if (profIn.job_title !== undefined) profilePatch.job_title = stripHtml(String(profIn.job_title), 200);
      if (profIn.nationality !== undefined) profilePatch.nationality = stripHtml(String(profIn.nationality), 100);
      if (profIn.place_of_birth !== undefined) {
        profilePatch.place_of_birth = stripHtml(String(profIn.place_of_birth), 200);
      }
      if (profIn.town_country_of_origin !== undefined) {
        profilePatch.town_country_of_origin = stripHtml(String(profIn.town_country_of_origin), 200);
      }
      if (profIn.future_settlement_plans !== undefined) {
        profilePatch.future_settlement_plans = stripHtml(String(profIn.future_settlement_plans), 200);
      }
      if (profIn.hobbies !== undefined) profilePatch.hobbies = stripHtml(String(profIn.hobbies), 400);

      if (profIn.height_cm !== undefined) {
        if (profIn.height_cm === null || profIn.height_cm === '') profilePatch.height_cm = null;
        else profilePatch.height_cm = Math.max(0, Math.floor(Number(profIn.height_cm)));
      }
      if (profIn.weight_kg !== undefined) {
        if (profIn.weight_kg === null || profIn.weight_kg === '') profilePatch.weight_kg = null;
        else profilePatch.weight_kg = Math.max(0, Math.floor(Number(profIn.weight_kg)));
      }

      if (profIn.diet !== undefined) {
        const d = String(profIn.diet);
        if (!['Veg', 'Non-veg', 'Vegan'].includes(d)) {
          return jsonResponse({ error: 'Invalid diet' }, req, 400);
        }
        profilePatch.diet = d;
      }
      if (profIn.religion !== undefined) {
        const r = String(profIn.religion);
        if (!['Jain', 'Hindu', 'Other'].includes(r)) {
          return jsonResponse({ error: 'Invalid religion' }, req, 400);
        }
        profilePatch.religion = r;
      }
      if (profIn.community !== undefined) {
        if (profIn.community === null || profIn.community === '') {
          profilePatch.community = null;
        } else {
          const c = String(profIn.community);
          if (!['Vanik', 'Lohana', 'Brahmin', 'Other'].includes(c)) {
            return jsonResponse({ error: 'Invalid community' }, req, 400);
          }
          profilePatch.community = c;
        }
      }

      if (profIn.photo_url !== undefined) {
        profilePatch.photo_url = profIn.photo_url === null || profIn.photo_url === ''
          ? null
          : stripHtml(String(profIn.photo_url), 500);
      }
      if (profIn.pending_photo_url !== undefined) {
        profilePatch.pending_photo_url = profIn.pending_photo_url === null || profIn.pending_photo_url === ''
          ? null
          : stripHtml(String(profIn.pending_photo_url), 500);
      }
      if (profIn.photo_status !== undefined) {
        const ps = String(profIn.photo_status);
        if (!['pending', 'approved', 'rejected'].includes(ps)) {
          return jsonResponse({ error: 'Invalid photo_status' }, req, 400);
        }
        profilePatch.photo_status = ps;
      }

      if (profIn.status !== undefined) {
        const st = String(profIn.status);
        if (
          !['pending_approval', 'active', 'rejected', 'expired', 'archived', 'matched'].includes(st)
        ) {
          return jsonResponse({ error: 'Invalid status' }, req, 400);
        }
        profilePatch.status = st;
      }

      if (profIn.show_on_register !== undefined) {
        profilePatch.show_on_register = !!profIn.show_on_register;
      }

      if (profIn.rejection_reason !== undefined) {
        profilePatch.rejection_reason =
          profIn.rejection_reason === null || profIn.rejection_reason === ''
            ? null
            : stripHtml(String(profIn.rejection_reason), 2000);
      }

      if (profIn.membership_expires_at !== undefined) {
        if (profIn.membership_expires_at === null || profIn.membership_expires_at === '') {
          profilePatch.membership_expires_at = null;
        } else {
          const d = new Date(String(profIn.membership_expires_at));
          if (Number.isNaN(d.getTime())) {
            return jsonResponse({ error: 'Invalid membership_expires_at' }, req, 400);
          }
          profilePatch.membership_expires_at = d.toISOString();
        }
      }
      if (profIn.last_request_at !== undefined) {
        if (profIn.last_request_at === null || profIn.last_request_at === '') {
          profilePatch.last_request_at = null;
        } else {
          const d = new Date(String(profIn.last_request_at));
          if (Number.isNaN(d.getTime())) {
            return jsonResponse({ error: 'Invalid last_request_at' }, req, 400);
          }
          profilePatch.last_request_at = d.toISOString();
        }
      }
    }

    if (profilePatch.status === 'pending_approval') {
      profilePatch.rejection_reason = null;
    }

    const privatePatch: Record<string, unknown> = {};
    if (privIn) {
      if (privIn.surname !== undefined) {
        const sn = stripHtml(String(privIn.surname), 80);
        if (!sn) return jsonResponse({ error: 'surname cannot be empty' }, req, 400);
        privatePatch.surname = sn;
      }
      if (privIn.date_of_birth !== undefined) {
        const dob = String(privIn.date_of_birth).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          return jsonResponse({ error: 'date_of_birth must be YYYY-MM-DD' }, req, 400);
        }
        privatePatch.date_of_birth = dob;
      }
      if (privIn.email !== undefined) privatePatch.email = stripHtml(String(privIn.email), 120);
      if (privIn.mobile_phone !== undefined) {
        privatePatch.mobile_phone = stripHtml(String(privIn.mobile_phone), 40);
      }
      if (privIn.home_address_line1 !== undefined) {
        privatePatch.home_address_line1 = stripHtml(String(privIn.home_address_line1), 200);
      }
      if (privIn.home_address_city !== undefined) {
        privatePatch.home_address_city = stripHtml(String(privIn.home_address_city), 100);
      }
      if (privIn.home_address_postcode !== undefined) {
        privatePatch.home_address_postcode = stripHtml(String(privIn.home_address_postcode), 20);
      }
      if (privIn.home_address_country !== undefined) {
        privatePatch.home_address_country = stripHtml(String(privIn.home_address_country), 80);
      }
      if (privIn.father_name !== undefined) {
        privatePatch.father_name = stripHtml(String(privIn.father_name), 120);
      }
      if (privIn.mother_name !== undefined) {
        privatePatch.mother_name = stripHtml(String(privIn.mother_name), 120);
      }
      if (privIn.id_document_url !== undefined) {
        privatePatch.id_document_url =
          privIn.id_document_url === null || privIn.id_document_url === ''
            ? null
            : stripHtml(String(privIn.id_document_url), 500);
      }
      if (privIn.coupon_used !== undefined) {
        if (privIn.coupon_used === null || privIn.coupon_used === '') {
          privatePatch.coupon_used = null;
        } else {
          const code = stripHtml(String(privIn.coupon_used), 32).toUpperCase();
          const { data: cRow } = await admin.from('coupons').select('code').eq('code', code).maybeSingle();
          if (!cRow) return jsonResponse({ error: `Unknown coupon code: ${code}` }, req, 400);
          privatePatch.coupon_used = code;
        }
      }
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error: u1 } = await admin.from('profiles').update(profilePatch).eq('id', profileId);
      if (u1) return jsonResponse({ error: u1.message }, req, 500);
    }
    if (Object.keys(privatePatch).length > 0) {
      const { error: u2 } = await admin.from('member_private').update(privatePatch).eq('profile_id', profileId);
      if (u2) return jsonResponse({ error: u2.message }, req, 500);
    }

    const { data: afterProf } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: afterPriv } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();

    const diffLines: string[] = [];
    const bProf = (beforeProf ?? {}) as Record<string, unknown>;
    const aProf = (afterProf ?? {}) as Record<string, unknown>;
    const bPriv = (beforePriv ?? {}) as Record<string, unknown>;
    const aPriv = (afterPriv ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(profilePatch)) {
      const prev = JSON.stringify(bProf[k]);
      const next = JSON.stringify(aProf[k]);
      if (prev !== next) diffLines.push(`profiles.${k}: ${prev} → ${next}`);
    }
    for (const k of Object.keys(privatePatch)) {
      const prev = JSON.stringify(bPriv[k]);
      const next = JSON.stringify(aPriv[k]);
      if (prev !== next) diffLines.push(`member_private.${k}: ${prev} → ${next}`);
    }
    const changeSummary = diffLines.join('\n').slice(0, 24000);

    const editNote = stripHtml(String(body.edit_note ?? ''), 500);
    const notesParts = [editNote || 'Record updated by admin'];
    if (changeSummary) notesParts.push('Changes:\n' + changeSummary);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'profile_admin_edit',
      notes: notesParts.join('\n\n').slice(0, 30000),
    });

    return jsonResponse({ ok: true }, req);
  }

  if (action === 'get_member_detail') {
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);

    const { data: profile, error: pErr } = await admin.from('profiles').select('*').eq('id', profileId).single();
    if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
    const { data: memberPrivate, error: mErr } = await admin
      .from('member_private')
      .select('*')
      .eq('profile_id', profileId)
      .single();
    if (mErr) return jsonResponse({ error: mErr.message }, req, 500);

    const prof = profile as {
      photo_url: string | null;
      pending_photo_url: string | null;
    };
    const priv = memberPrivate as { id_document_url: string | null };

    const signedUrls: { photo: string | null; pending_photo: string | null; id_document: string | null } = {
      photo: null,
      pending_photo: null,
      id_document: null,
    };
    if (prof.photo_url) {
      const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(prof.photo_url, 3600);
      signedUrls.photo = s?.signedUrl ?? null;
    }
    if (prof.pending_photo_url) {
      const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(prof.pending_photo_url, 900);
      signedUrls.pending_photo = s?.signedUrl ?? null;
    }
    if (priv.id_document_url) {
      const { data: s } = await admin.storage.from('id-documents').createSignedUrl(priv.id_document_url, 3600);
      signedUrls.id_document = s?.signedUrl ?? null;
    }

    const { data: actions, error: aErr } = await admin
      .from('admin_actions')
      .select('id, action_type, notes, created_at, admin_user_id')
      .eq('target_profile_id', profileId)
      .order('created_at', { ascending: false });
    if (aErr) return jsonResponse({ error: aErr.message }, req, 500);

    const adminIds = [
      ...new Set(
        (actions ?? [])
          .map((a: { admin_user_id: string | null }) => a.admin_user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const emailByUserId: Record<string, string | null> = {};
    for (const uid of adminIds) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      emailByUserId[uid] = u.user?.email ?? null;
    }

    const timeline = (actions ?? []).map(
      (a: { id: string; action_type: string; notes: string | null; created_at: string; admin_user_id: string | null }) => ({
        id: a.id,
        action_type: a.action_type,
        notes: a.notes,
        created_at: a.created_at,
        admin_email: a.admin_user_id ? emailByUserId[a.admin_user_id] ?? null : null,
      })
    );

    const { data: noteRow } = await admin
      .from('admin_profile_notes')
      .select('body, updated_at, updated_by')
      .eq('profile_id', profileId)
      .maybeSingle();

    const { data: recentEmails } = await admin
      .from('email_log')
      .select('id, email_type, subject, sent_at, status')
      .eq('recipient_profile_id', profileId)
      .order('sent_at', { ascending: false })
      .limit(10);

    return jsonResponse({
      profile,
      member_private: memberPrivate,
      signed_urls: signedUrls,
      timeline,
      admin_note: noteRow ?? { body: '', updated_at: null, updated_by: null },
      recent_emails: recentEmails ?? [],
    }, req);
  }

  if (action === 'list_email_log') {
    const limit =
      typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 1000 ? Math.floor(body.limit) : 300;
    const { data, error } = await admin
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    return jsonResponse({ rows: data ?? [] }, req);
  }

  if (action === 'list_cron_runs') {
    const jobNames = Array.isArray(body.job_names)
      ? body.job_names.filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    if (jobNames.length === 0) return jsonResponse({ error: 'job_names required' }, req, 400);
    const limit =
      typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 500 ? Math.floor(body.limit) : 100;
    const { data, error } = await admin
      .from('cron_job_runs')
      .select('*')
      .in('job_name', jobNames)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    return jsonResponse({ runs: data ?? [] }, req);
  }

  if (action === 'coupons_data') {
    const { data: coupons, error: cErr } = await admin
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (cErr) return jsonResponse({ error: cErr.message }, req, 500);

    const { data: usageRows, error: uErr } = await admin
      .from('member_private')
      .select('profile_id, coupon_used')
      .not('coupon_used', 'is', null)
      .order('profile_id');
    if (uErr) return jsonResponse({ error: uErr.message }, req, 500);

    const usage = usageRows ?? [];
    const profileIds = [...new Set((usage as { profile_id: string }[]).map((r) => r.profile_id))];
    const profilesById: Record<
      string,
      { first_name: string; reference_number: string | null; created_at: string }
    > = {};
    if (profileIds.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number, created_at')
        .in('id', profileIds);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as {
          id: string;
          first_name: string;
          reference_number: string | null;
          created_at: string;
        };
        profilesById[row.id] = {
          first_name: row.first_name,
          reference_number: row.reference_number,
          created_at: row.created_at,
        };
      }
    }

    const usageWithProfiles = (usage as { profile_id: string; coupon_used: string }[]).map((r) => ({
      profile_id: r.profile_id,
      coupon_used: r.coupon_used,
      profiles: profilesById[r.profile_id] ?? null,
    }));

    return jsonResponse({ coupons: coupons ?? [], usage: usageWithProfiles }, req);
  }

  if (action === 'create_coupon') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot create coupons' }, req, 403);
    }
    const codeRaw = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!codeRaw) return jsonResponse({ error: 'code required' }, req, 400);
    const type = body.type === 'discount_percent' ? 'discount_percent' : 'free';
    let discountPercent: number | null = null;
    if (type === 'discount_percent') {
      const n = Number(body.discount_percent);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return jsonResponse({ error: 'discount_percent must be 1–100' }, req, 400);
      }
      discountPercent = n;
    }
    const maxUses =
      body.max_uses != null && body.max_uses !== ''
        ? Math.floor(Number(body.max_uses))
        : null;
    if (maxUses != null && (!Number.isFinite(maxUses) || maxUses < 1)) {
      return jsonResponse({ error: 'max_uses invalid' }, req, 400);
    }
    const expiresAt =
      typeof body.expires_at === 'string' && body.expires_at.trim()
        ? new Date(body.expires_at).toISOString()
        : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const { error: insErr } = await admin.from('coupons').insert({
      code: codeRaw,
      type,
      discount_percent: discountPercent,
      max_uses: maxUses,
      expires_at: expiresAt,
      notes,
      is_active: true,
      created_by: callerId,
    });
    if (insErr) return jsonResponse({ error: insErr.message }, req, 500);
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'revoke_coupon') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot revoke coupons' }, req, 403);
    }
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) return jsonResponse({ error: 'code required' }, req, 400);
    const { error: upErr } = await admin.from('coupons').update({ is_active: false }).eq('code', code);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'set_admin_role') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const targetId = typeof body.user_id === 'string' ? body.user_id : '';
    const role = body.role === 'support' ? 'support' : body.role === 'super' ? 'super' : '';
    if (!targetId || !role) {
      return jsonResponse({ error: 'user_id and role (super|support) required' }, req, 400);
    }
    const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
    if (gErr || !target.user) {
      return jsonResponse({ error: 'User not found' }, req, 404);
    }
    const am0 = target.user.app_metadata as Record<string, unknown> | undefined;
    if (!metaIsAdminFlag(am0?.is_admin)) {
      return jsonResponse({ error: 'Target is not an admin' }, req, 400);
    }
    const am = { ...am0, is_admin: true, admin_role: role };
    const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: am });
    if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'admin_role_changed',
      notes: `user_id=${targetId} role=${role}`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'set_internal_note') {
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const noteBody = stripHtml(String(body.note ?? ''), 20000);
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { error: nErr } = await admin.from('admin_profile_notes').upsert(
      {
        profile_id: profileId,
        body: noteBody,
        updated_at: new Date().toISOString(),
        updated_by: callerId,
      },
      { onConflict: 'profile_id' }
    );
    if (nErr) return jsonResponse({ error: nErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'internal_note_updated',
      notes: 'Staff internal note saved',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'purge_id_document') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: privRow, error: pe } = await admin
      .from('member_private')
      .select('id_document_url')
      .eq('profile_id', profileId)
      .single();
    if (pe || !privRow) return jsonResponse({ error: 'Member not found' }, req, 404);
    const path = privRow.id_document_url as string | null;
    if (path) {
      const { error: rmErr } = await admin.storage.from('id-documents').remove([path]);
      if (rmErr) return jsonResponse({ error: rmErr.message }, req, 500);
    }
    const { error: upErr } = await admin
      .from('member_private')
      .update({ id_document_url: null, id_document_deleted_at: new Date().toISOString() })
      .eq('profile_id', profileId);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'id_document_purged',
      notes: path ? `Removed storage object` : 'No file on record',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'resend_member_email') {
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const template = typeof body.template === 'string' ? body.template : '';
    const allowed = new Set([
      'admin_pending_reminder',
      'registration_received',
      'registration_approved',
      'registration_rejected',
      'renewal_reminder',
      'membership_expired',
    ]);
    if (!profileId || !allowed.has(template)) {
      return jsonResponse({ error: 'profile_id and valid template required' }, req, 400);
    }
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return jsonResponse({ error: 'Email provider not configured' }, req, 500);

    const { data: profT } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: memT } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();
    if (!profT || !memT) return jsonResponse({ error: 'Profile not found' }, req, 404);

    const extra: Record<string, unknown> = {};
    if (template === 'registration_received') {
      extra.first_name = profT.first_name;
      extra.resubmitted = body.resubmitted === true;
    }
    if (template === 'registration_rejected') {
      extra.reason = profT.rejection_reason ?? 'Please see previous correspondence.';
    }
    if (template === 'renewal_reminder') {
      extra.days = typeof body.days === 'number' ? Math.min(90, Math.max(1, body.days)) : 30;
    }

    const r = await dispatchEmail(admin, resendKey, {
      type: template as EmailType,
      recipientProfileId: profileId,
      extraData: extra,
    });
    if (!r.ok) return jsonResponse({ error: r.error ?? 'Send failed' }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'email_resent',
      notes: `template=${template}`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'send_pending_reminders') {
    const ids = Array.isArray(body.profile_ids) ? body.profile_ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0 || ids.length > 40) {
      return jsonResponse({ error: 'profile_ids array required (max 40)' }, req, 400);
    }
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return jsonResponse({ error: 'Email provider not configured' }, req, 500);
    let sent = 0;
    const skipped: string[] = [];
    for (const pid of ids) {
      const { data: p } = await admin.from('profiles').select('status').eq('id', pid).single();
      if (p?.status !== 'pending_approval') {
        skipped.push(pid);
        continue;
      }
      const r = await dispatchEmail(admin, resendKey, {
        type: 'admin_pending_reminder',
        recipientProfileId: pid,
      });
      if (r.ok) sent++;
    }
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'bulk_pending_reminder',
      notes: `sent=${sent} skipped=${skipped.length}`,
    });
    return jsonResponse({ ok: true, sent, skipped }, req);
  }

  if (action === 'generate_member_magic_link') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: memE } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
    const email = memE?.email as string | undefined;
    if (!email) return jsonResponse({ error: 'No email for profile' }, req, 400);
    const redirectTo = `${siteUrlFromEnv()}/dashboard/browse`;
    const { data: linkData, error: le } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (le || !linkData?.properties?.action_link) {
      return jsonResponse({ error: le?.message ?? 'Could not generate link' }, req, 500);
    }
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'impersonation_magic_link',
      notes: 'One-time magic link generated (not stored)',
    });
    return jsonResponse({ action_link: linkData.properties.action_link }, req);
  }

  if (action === 'revoke_member_sessions') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: prow } = await admin.from('profiles').select('auth_user_id').eq('id', profileId).single();
    const uid = prow?.auth_user_id as string | undefined;
    if (!uid) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const { error: banErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: '2s' });
    if (banErr) return jsonResponse({ error: banErr.message }, req, 500);
    await new Promise((r) => setTimeout(r, 2100));
    const { error: unbanErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' });
    if (unbanErr) return jsonResponse({ error: unbanErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'sessions_revoked',
      notes: 'Brief account lock to invalidate refresh tokens',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'send_password_recovery_for_member') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: memE } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
    const email = memE?.email as string | undefined;
    if (!email) return jsonResponse({ error: 'No email for profile' }, req, 400);
    const redirectTo = `${siteUrlFromEnv()}/login`;
    const { error: re } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });
    if (re) return jsonResponse({ error: re.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'password_recovery_sent',
      notes: 'Recovery email triggered via admin',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'admin_upload_member_photo') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot upload member photos' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const rawB64 = typeof body.image_base64 === 'string' ? body.image_base64.trim() : '';
    const mode = body.mode === 'pending_review' ? 'pending_review' : 'direct';
    if (!profileId || !rawB64) {
      return jsonResponse({ error: 'profile_id and image_base64 required' }, req, 400);
    }

    let b64 = rawB64.replace(/\s/g, '');
    const dataUrl = /^data:image\/(?:jpeg|jpg|png);base64,(.+)$/i.exec(b64);
    if (dataUrl) b64 = dataUrl[1];

    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      if (bin.length < 200 || bin.length > 2_500_000) {
        return jsonResponse({ error: 'Image size must be between 200 bytes and 2.5MB' }, req, 400);
      }
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return jsonResponse({ error: 'Invalid base64 image' }, req, 400);
    }

    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isJpeg && !isPng) {
      return jsonResponse({ error: 'Image must be JPEG or PNG (by file content)' }, req, 400);
    }
    const contentType = isJpeg ? 'image/jpeg' : 'image/png';
    const ext = isJpeg ? 'jpg' : 'png';

    const { data: prof, error: pe } = await admin
      .from('profiles')
      .select('id, gender, auth_user_id, photo_url, pending_photo_url')
      .eq('id', profileId)
      .single();
    if (pe || !prof) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const gender = String(prof.gender);
    if (gender !== 'Male' && gender !== 'Female') {
      return jsonResponse({ error: 'Invalid profile gender' }, req, 400);
    }
    const authUid = prof.auth_user_id as string;
    const baseFolder = `${gender}/${authUid}`;
    const objectPath =
      mode === 'pending_review' ? `${baseFolder}/photo-pending.${ext}` : `${baseFolder}/photo.${ext}`;

    const { error: upErr } = await admin.storage.from('profile-photos').upload(objectPath, bytes, {
      upsert: true,
      contentType,
    });
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);

    const oldMain = prof.photo_url as string | null;
    const oldPending = prof.pending_photo_url as string | null;

    if (mode === 'direct') {
      if (oldMain && oldMain !== objectPath) {
        const { error: rmErr } = await admin.storage.from('profile-photos').remove([oldMain]);
        if (rmErr) console.warn('admin_upload_member_photo remove old main:', rmErr.message);
      }
      if (oldPending && oldPending !== objectPath) {
        const { error: rm2 } = await admin.storage.from('profile-photos').remove([oldPending]);
        if (rm2) console.warn('admin_upload_member_photo remove old pending:', rm2.message);
      }
      const { error: dbErr } = await admin
        .from('profiles')
        .update({
          photo_url: objectPath,
          pending_photo_url: null,
          photo_status: 'approved',
        })
        .eq('id', profileId);
      if (dbErr) return jsonResponse({ error: dbErr.message }, req, 500);
    } else {
      if (oldPending && oldPending !== objectPath) {
        const { error: rmErr } = await admin.storage.from('profile-photos').remove([oldPending]);
        if (rmErr) console.warn('admin_upload_member_photo remove old pending:', rmErr.message);
      }
      const { error: dbErr } = await admin
        .from('profiles')
        .update({
          pending_photo_url: objectPath,
          photo_status: 'pending',
        })
        .eq('id', profileId);
      if (dbErr) return jsonResponse({ error: dbErr.message }, req, 500);
    }

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'photo_admin_upload',
      notes: mode === 'direct' ? `direct path=${objectPath}` : `pending_review path=${objectPath}`,
    });

    return jsonResponse({ ok: true, path: objectPath, mode }, req);
  }

  if (action === 'promote' || action === 'demote') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot change admin accounts' }, req, 403);
    }
    const targetId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!targetId) {
      return jsonResponse({ error: 'user_id required' }, req, 400);
    }

    if (action === 'promote') {
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
      if (gErr || !target.user) {
        return jsonResponse({ error: 'User not found' }, req, 404);
      }
      const am = {
        ...(target.user.app_metadata as Record<string, unknown> | undefined),
        is_admin: true,
        admin_role: 'super',
      };
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: am });
      if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
      return jsonResponse({ ok: true }, req);
    }

    if (action === 'demote') {
      if (targetId === callerId) {
        return jsonResponse({ error: 'You cannot demote your own account' }, req, 400);
      }
      let adminCount = 0;
      let page = 1;
      const perPage = 1000;
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) return jsonResponse({ error: error.message }, req, 500);
        const batch = data?.users ?? [];
        for (const u of batch) {
          const am = u.app_metadata as Record<string, unknown> | undefined;
          if (metaIsAdminFlag(am?.is_admin)) adminCount++;
        }
        if (batch.length < perPage) break;
        page++;
      }
      if (adminCount <= 1) {
        return jsonResponse({ error: 'Cannot demote the last admin' }, req, 400);
      }
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
      if (gErr || !target.user) {
        return jsonResponse({ error: 'User not found' }, req, 404);
      }
      const prev = { ...(target.user.app_metadata as Record<string, unknown> | undefined) };
      prev.is_admin = false;
      delete prev.admin_role;
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: prev });
      if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
      return jsonResponse({ ok: true }, req);
    }
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
