import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

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
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: { candidate_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const ids = (body.candidate_ids ?? []).filter(Boolean).slice(0, 3);
  if (ids.length === 0) {
    return jsonResponse({ error: 'candidates required' }, 400);
  }

  const admin = getAdminClient();

  const { data: requester, error: reErr } = await admin
    .from('profiles')
    .select('id, first_name, gender, reference_number, status, membership_expires_at')
    .eq('auth_user_id', userData.user.id)
    .single();
  if (reErr || !requester) {
    return jsonResponse({ error: 'Profile not found' }, 400);
  }

  if (
    requester.status !== 'active' ||
    !requester.membership_expires_at ||
    new Date(requester.membership_expires_at) <= new Date()
  ) {
    return jsonResponse({ error: 'Membership not active' }, 403);
  }

  const { data: requesterPrivate } = await admin
    .from('member_private')
    .select('email')
    .eq('profile_id', requester.id)
    .single();

  // Weekly limit: max 3 total candidate slots in a rolling 7-day window.
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
  const slotsUsed = usedCandidateIds.size;
  const slotsRemaining = Math.max(0, 3 - slotsUsed);

  if (slotsRemaining === 0) {
    const reset = oldestCreatedAt
      ? new Date(new Date(oldestCreatedAt).getTime() + 7 * 864e5)
      : new Date(Date.now() + 7 * 864e5);
    return jsonResponse(
      {
        error: 'weekly_limit',
        message: `Weekly limit reached (3 candidates). Resets on ${reset.toLocaleDateString('en-GB')}.`,
      },
      400
    );
  }

  if (ids.length > slotsRemaining) {
    return jsonResponse(
      {
        error: 'weekly_limit',
        message: `You have ${slotsRemaining} candidate slot${slotsRemaining === 1 ? '' : 's'} remaining this week. Please reduce your selection.`,
        slots_remaining: slotsRemaining,
      },
      400
    );
  }

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
    return jsonResponse(
      {
        error: 'feedback_required',
        message: 'Outstanding feedback required before new requests.',
        request_ids: [...new Set(outstandingIds)],
      },
      400
    );
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
    return jsonResponse({ error: insErr?.message ?? 'Insert failed' }, 500);
  }

  const requestId = ins.id as string;

  const candidatesHtmlParts: string[] = [];
  const contactPayload: Array<Record<string, string>> = [];

  for (const cid of ids) {
    const { data: p } = await admin.from('profiles').select('*').eq('id', cid).single();
    const { data: m } = await admin.from('member_private').select('*').eq('profile_id', cid).single();
    if (!p || !m) continue;
    const fullName = `${stripHtml(p.first_name, 80)} ${stripHtml(m.surname, 80)}`;
    contactPayload.push({
      profile_id: cid,
      first_name: stripHtml(p.first_name, 80),
      full_name: fullName,
      reference_number: stripHtml(p.reference_number ?? '', 20),
      mobile: stripHtml(m.mobile_phone, 40),
      email: stripHtml(m.email, 120),
      father_name: stripHtml(m.father_name ?? '', 120),
      mother_name: stripHtml(m.mother_name ?? '', 120),
    });
    candidatesHtmlParts.push(
      `<div style="margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <p><strong>${fullName}</strong> — Ref ${stripHtml(p.reference_number ?? '', 20)}</p>
        <p>Mobile: ${stripHtml(m.mobile_phone, 40)}<br/>Email: ${stripHtml(m.email, 120)}</p>
        <p>Father: ${stripHtml(m.father_name ?? '', 120)}<br/>Mother: ${stripHtml(m.mother_name ?? '', 120)}</p>
      </div>`
    );
  }

  await admin
    .from('profiles')
    .update({ last_request_at: new Date().toISOString() })
    .eq('id', requester.id);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  let emailOk = true;
  if (resendKey) {
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
  }

  await admin
    .from('requests')
    .update({
      email_sent_at: new Date().toISOString(),
      email_status: emailOk ? 'sent' : 'failed',
    })
    .eq('id', requestId);

  return jsonResponse({
    ok: true,
    request_id: requestId,
    contacts: contactPayload,
    requester_email: requesterPrivate?.email ?? '',
  });
});
