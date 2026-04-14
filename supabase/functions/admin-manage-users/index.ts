import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { metaIsAdminFlag, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

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
    let q = admin.from('profiles').select('*').order('created_at', { ascending: false });
    if (f === 'pending') q = q.eq('status', 'pending_approval');
    else if (f === 'active') q = q.eq('status', 'active');
    else if (f === 'expired') q = q.eq('status', 'expired');
    else if (f === 'rejected') q = q.eq('status', 'rejected');
    else if (f === 'archived') q = q.eq('status', 'archived');
    else if (f === 'matched') q = q.eq('status', 'matched');
    else if (f === 'lapsed90') {
      q = q.eq('status', 'expired').lt('membership_expires_at', lapseCutoff);
    } else if (f !== 'all') {
      return jsonResponse({ error: 'Invalid filter' }, req, 400);
    }
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
    const users: Array<{ id: string; email: string | undefined; is_admin: boolean; created_at: string }> = [];
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ error: error.message }, req, 500);
      const batch = data?.users ?? [];
      for (const u of batch) {
               const am = u.app_metadata as Record<string, unknown> | undefined;
        const adminFlag = metaIsAdminFlag(am?.is_admin);
        users.push({
          id: u.id,
          email: u.email,
          is_admin: adminFlag,
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
    ]);

    const errors = [pending.error, requestsWeek.error, expiring.error, flagged.error, lapsed90.error, actRes.error]
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
      },
      actions: actRes.data ?? [],
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
      .select('*')
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

    return jsonResponse({
      profile,
      member_private: memberPrivate,
      signed_urls: signedUrls,
      timeline,
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
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) return jsonResponse({ error: 'code required' }, req, 400);
    const { error: upErr } = await admin.from('coupons').update({ is_active: false }).eq('code', code);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'promote' || action === 'demote') {
    const targetId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!targetId) {
      return jsonResponse({ error: 'user_id required' }, req, 400);
    }

    if (action === 'promote') {
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
      if (gErr || !target.user) {
        return jsonResponse({ error: 'User not found' }, req, 404);
      }
      const am = { ...(target.user.app_metadata as Record<string, unknown> | undefined), is_admin: true };
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
      const am = { ...(target.user.app_metadata as Record<string, unknown> | undefined), is_admin: false };
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: am });
      if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
      return jsonResponse({ ok: true }, req);
    }
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
