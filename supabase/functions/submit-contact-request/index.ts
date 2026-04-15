import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

type ProfileCandidate = {
  id: string;
  first_name: string;
  gender: string;
  reference_number: string | null;
  status: string;
  show_on_register: boolean;
  membership_expires_at: string | null;
};

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
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  let body: { candidate_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const ids = [...new Set((body.candidate_ids ?? []).filter(Boolean))].slice(0, 3);
  if (ids.length === 0) {
    return jsonResponse({ error: 'candidates required' }, req, 400);
  }

  const admin = getAdminClient();

  const { data: requester, error: reErr } = await admin
    .from('profiles')
    .select('id, first_name, gender, seeking_gender, reference_number, status, membership_expires_at')
    .eq('auth_user_id', userData.user.id)
    .single();
  if (reErr || !requester) {
    return jsonResponse({ error: 'Profile not found' }, req, 400);
  }

  if (
    requester.status !== 'active' ||
    !requester.membership_expires_at ||
    new Date(requester.membership_expires_at) <= new Date()
  ) {
    return jsonResponse({ error: 'Membership not active' }, req, 403);
  }

  const { data: requesterPrivate } = await admin
    .from('member_private')
    .select('email')
    .eq('profile_id', requester.id)
    .single();

  const cutoff = new Date(Date.now() - 21 * 864e5).toISOString();
  const { data: staleRequests } = await admin
    .from('requests')
    .select('id, candidate_ids')
    .eq('requester_id', requester.id)
    .lt('created_at', cutoff);

  const outstandingIds: string[] = [];
  for (const r of staleRequests ?? []) {
    const cids = (r.candidate_ids as string[]) ?? [];
    for (const cid of cids) {
      const { count } = await admin
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('request_id', r.id)
        .eq('candidate_id', cid);
      if ((count ?? 0) === 0) {
        outstandingIds.push(r.id as string);
      }
    }
  }
  if (outstandingIds.length) {
    return jsonResponse({
      error: 'feedback_required',
      message:
        'Outstanding feedback required before new requests. Please complete feedback for introductions older than 21 days.',
      request_ids: [...new Set(outstandingIds)],
    }, req, 400);
  }

  // Weekly limit: max 3 distinct candidates in a rolling 7-day window.
  const weekStart = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: recentRequests } = await admin
    .from('requests')
    .select('candidate_ids, created_at')
    .eq('requester_id', requester.id)
    .gte('created_at', weekStart)
    .order('created_at', { ascending: true });

  const usedCandidateIds = new Set<string>();
  let oldestCreatedAt: string | null = null;
  for (const r of recentRequests ?? []) {
    for (const cid of (r.candidate_ids as string[]) ?? []) usedCandidateIds.add(cid);
    if (!oldestCreatedAt) oldestCreatedAt = r.created_at as string;
  }

  for (const cid of ids) {
    if (usedCandidateIds.has(cid)) {
      return jsonResponse({
        error: 'already_requested_this_week',
        message:
          'You already requested this profile within the last 7 days. You can ask again after that window, subject to weekly limits.',
      }, req, 400);
    }
  }

  const slotsUsed = usedCandidateIds.size;
  const slotsRemaining = Math.max(0, 3 - slotsUsed);

  if (slotsRemaining === 0) {
    const reset = oldestCreatedAt
      ? new Date(new Date(oldestCreatedAt).getTime() + 7 * 864e5)
      : new Date(Date.now() + 7 * 864e5);
    return jsonResponse({
      error: 'weekly_limit',
      message: `Weekly limit reached (3 candidates). Resets on ${reset.toLocaleDateString('en-GB')}.`,
    }, req, 400);
  }

  if (ids.length > slotsRemaining) {
    return jsonResponse({
      error: 'weekly_limit',
      message: `You have ${slotsRemaining} candidate slot${slotsRemaining === 1 ? '' : 's'} remaining this week. Please reduce your selection.`,
      slots_remaining: slotsRemaining,
    }, req, 400);
  }

  const now = new Date();
  const { data: candProfiles, error: cpErr } = await admin
    .from('profiles')
    .select('id, first_name, gender, reference_number, status, show_on_register, membership_expires_at')
    .in('id', ids);
  if (cpErr) {
    return jsonResponse({ error: cpErr.message }, req, 500);
  }
  const byId = new Map((candProfiles ?? []).map((p) => [(p as ProfileCandidate).id, p as ProfileCandidate]));

  for (const cid of ids) {
    const p = byId.get(cid);
    if (!p) {
      return jsonResponse(
        { error: 'invalid_candidate', message: 'One or more profiles could not be found.' },
        req,
        400
      );
    }
    const seek =
      (requester as { seeking_gender?: string }).seeking_gender ??
      (requester.gender === 'Female' ? 'Male' : 'Female');
    if (seek !== 'Both' && seek !== p.gender) {
      return jsonResponse(
        {
          error: 'invalid_candidate',
          message:
            'This profile does not match who you are looking for. Change it under Browse or My profile, then try again.',
        },
        req,
        400
      );
    }
    if (p.status !== 'active') {
      return jsonResponse(
        { error: 'invalid_candidate', message: 'This profile is not available for contact requests.' },
        req,
        400
      );
    }
    if (!p.show_on_register) {
      return jsonResponse(
        { error: 'invalid_candidate', message: 'This profile is not listed on the register.' },
        req,
        400
      );
    }
    if (!p.membership_expires_at || new Date(p.membership_expires_at) <= now) {
      return jsonResponse(
        { error: 'invalid_candidate', message: 'This member’s membership is not active.' },
        req,
        400
      );
    }
  }

  const { data: candPrivate, error: mpErr } = await admin
    .from('member_private')
    .select('*')
    .in('profile_id', ids);
  if (mpErr) {
    return jsonResponse({ error: mpErr.message }, req, 500);
  }
  const privateById = new Map(
    (candPrivate ?? []).map((m) => [m.profile_id as string, m as Record<string, unknown>])
  );

  for (const cid of ids) {
    const m = privateById.get(cid);
    if (!m) {
      return jsonResponse(
        {
          error: 'candidate_data_incomplete',
          message: 'We could not load full details for one profile. Please try again or contact support.',
        },
        req,
        500
      );
    }
  }

  const { data: ins, error: insErr } = await admin
    .from('requests')
    .insert({
      requester_id: requester.id,
      candidate_ids: ids,
      email_status: 'pending',
    })
    .select('id')
    .single();
  if (insErr || !ins) {
    return jsonResponse({ error: insErr?.message ?? 'Insert failed' }, req, 500);
  }

  const requestId = ins.id as string;

  const candidatesHtmlParts: string[] = [];
  const contactPayload: Array<Record<string, string>> = [];

  for (const cid of ids) {
    const p = byId.get(cid)!;
    const m = privateById.get(cid)!;
    const fullName = `${stripHtml(p.first_name, 80)} ${stripHtml(String(m.surname ?? ''), 80)}`;
    contactPayload.push({
      profile_id: cid,
      first_name: stripHtml(p.first_name, 80),
      full_name: fullName,
      reference_number: stripHtml(p.reference_number ?? '', 20),
      mobile: stripHtml(String(m.mobile_phone ?? ''), 40),
      email: stripHtml(String(m.email ?? ''), 120),
      father_name: stripHtml(String(m.father_name ?? ''), 120),
      mother_name: stripHtml(String(m.mother_name ?? ''), 120),
    });
    candidatesHtmlParts.push(
      `<div style="margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <p><strong>${fullName}</strong> - Ref ${stripHtml(p.reference_number ?? '', 20)}</p>
        <p>Mobile: ${stripHtml(String(m.mobile_phone ?? ''), 40)}<br/>Email: ${stripHtml(String(m.email ?? ''), 120)}</p>
        <p>Father: ${stripHtml(String(m.father_name ?? ''), 120)}<br/>Mother: ${stripHtml(String(m.mother_name ?? ''), 120)}</p>
      </div>`
    );
  }

  await admin
    .from('profiles')
    .update({ last_request_at: new Date().toISOString() })
    .eq('id', requester.id);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  let emailStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  let emailOk = false;

  if (!resendKey) {
    emailStatus = 'skipped';
  } else {
    const er = await dispatchEmail(admin, resendKey, {
      type: 'contact_details',
      recipientProfileId: requester.id,
      extra_data: {
        requester_first_name: requester.first_name,
        requester_email: requesterPrivate?.email ?? '',
        candidates_html: candidatesHtmlParts.join(''),
      },
    });
    emailOk = er.ok;
    if (!emailOk) {
      emailStatus = 'failed';
    } else {
      for (const cid of ids) {
        await dispatchEmail(admin, resendKey, {
          type: 'candidate_notification',
          recipientProfileId: cid,
          extra_data: {
            requester_reference: requester.reference_number,
            requester_first_name: requester.first_name,
            requester_gender: requester.gender,
          },
        });
      }
      emailStatus = 'sent';
    }
  }

  await admin
    .from('requests')
    .update({
      email_sent_at: emailOk ? new Date().toISOString() : null,
      email_status: emailStatus,
    })
    .eq('id', requestId);

  return jsonResponse({
    ok: true,
    request_id: requestId,
    contacts: contactPayload,
    requester_email: requesterPrivate?.email ?? '',
  }, req);
});
