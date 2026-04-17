import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  try {
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

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, req, 400);
    }
    if (!rawBody || typeof rawBody !== 'object') {
      return jsonResponse({ error: 'Invalid JSON body' }, req, 400);
    }
    const candidateInput = (rawBody as { candidate_ids?: unknown }).candidate_ids;
    if (!Array.isArray(candidateInput)) {
      return jsonResponse({ error: 'candidate_ids must be an array' }, req, 400);
    }
    const parsedIds: string[] = [];
    for (const rawId of candidateInput) {
      if (typeof rawId !== 'string') {
        return jsonResponse({ error: 'candidate_ids must contain only strings' }, req, 400);
      }
      const id = rawId.trim();
      if (!id || !UUID_RE.test(id)) {
        return jsonResponse({ error: 'candidate_ids contains an invalid profile id' }, req, 400);
      }
      parsedIds.push(id);
    }

    const ids = [...new Set(parsedIds)];
    if (ids.length === 0) {
      return jsonResponse({ error: 'candidates required' }, req, 400);
    }
    if (ids.length > 3) {
      return jsonResponse({
        error: 'weekly_limit',
        message: 'You can request up to 3 candidates at a time.',
      }, req, 400);
    }

    const admin = getAdminClient();

    const { data: requester, error: reErr } = await admin
      .from('profiles')
      .select('id, first_name, gender, seeking_gender, reference_number, status, membership_expires_at')
      .eq('auth_user_id', userData.user.id)
      .single();
    if (reErr || !requester) {
      return jsonResponse({ error: 'Profile not found' }, req, 404);
    }

    if (
      requester.status !== 'active' ||
      !requester.membership_expires_at ||
      new Date(requester.membership_expires_at) <= new Date()
    ) {
      return jsonResponse({ error: 'Membership not active' }, req, 403);
    }

    const cutoff = new Date(Date.now() - 21 * 864e5).toISOString();
    const { data: staleRequests } = await admin
      .from('requests')
      .select('id, candidate_ids')
      .eq('requester_id', requester.id)
      .lt('created_at', cutoff);

    const staleList = staleRequests ?? [];
    if (staleList.length > 0) {
      const staleIds = staleList.map((r) => r.id as string);
      const { data: feedbackRows } = await admin
        .from('feedback')
        .select('request_id, candidate_id')
        .eq('requester_id', requester.id)
        .in('request_id', staleIds);

      const fed = new Set(
        (feedbackRows ?? []).map(
          (row) => `${row.request_id as string}:${row.candidate_id as string}`
        )
      );

      const outstandingRequestIds = new Set<string>();
      for (const r of staleList) {
        const cids = (r.candidate_ids as string[]) ?? [];
        for (const cid of cids) {
          if (!fed.has(`${r.id}:${cid}`)) outstandingRequestIds.add(r.id as string);
        }
      }

      if (outstandingRequestIds.size > 0) {
        return jsonResponse({
          error: 'feedback_required',
          message:
            'Outstanding feedback required before new requests. Please complete feedback for introductions older than 21 days.',
          request_ids: [...outstandingRequestIds],
        }, req, 409);
      }
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

    const { data: requestInsert, error: requestInsertErr } = await admin.rpc('create_contact_request_atomic', {
      p_requester_id: requester.id,
      p_candidate_ids: ids,
    });
    if (requestInsertErr) {
      console.error('create_contact_request_atomic failed', requestInsertErr);
      return jsonResponse({ error: requestInsertErr.message }, req, 500);
    }
    const insertRow = Array.isArray(requestInsert)
      ? (requestInsert[0] as {
          request_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          slots_remaining?: number | null;
          reset_at?: string | null;
        } | undefined)
      : undefined;

    if (!insertRow) {
      return jsonResponse({ error: 'Insert failed' }, req, 500);
    }
    if (insertRow.error_code) {
      if (insertRow.error_code === 'already_requested_this_week') {
        return jsonResponse({
          error: 'already_requested_this_week',
          message:
            insertRow.error_message ??
            'You already requested this profile within the last 7 days. You can ask again after that window, subject to weekly limits.',
        }, req, 409);
      }
      if (insertRow.error_code === 'weekly_limit') {
        return jsonResponse({
          error: 'weekly_limit',
          message: insertRow.error_message ?? 'Weekly limit reached.',
          slots_remaining: insertRow.slots_remaining ?? 0,
          reset_at: insertRow.reset_at ?? null,
        }, req, 409);
      }
      if (insertRow.error_code === 'monthly_limit') {
        return jsonResponse({
          error: 'monthly_limit',
          message: insertRow.error_message ?? 'Monthly limit reached.',
          slots_remaining: insertRow.slots_remaining ?? 0,
          reset_at: insertRow.reset_at ?? null,
        }, req, 409);
      }
      return jsonResponse({
        error: insertRow.error_code,
        message: insertRow.error_message ?? 'Request could not be created.',
      }, req, 409);
    }
    if (!insertRow.request_id) {
      return jsonResponse({ error: 'Insert failed' }, req, 500);
    }

    const requestId = insertRow.request_id;

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
    }

    const warnings: string[] = [];
    const { error: profileUpdateErr } = await admin
      .from('profiles')
      .update({ last_request_at: new Date().toISOString() })
      .eq('id', requester.id);
    if (profileUpdateErr) {
      console.error('Failed to set last_request_at', {
        requester_id: requester.id,
        message: profileUpdateErr.message,
      });
      warnings.push('Could not update requester metadata.');
    }

    const { error: requestUpdateErr } = await admin
      .from('requests')
      .update({
        email_sent_at: null,
        email_status: 'skipped',
      })
      .eq('id', requestId);
    if (requestUpdateErr) {
      console.error('Failed to update request email status', {
        request_id: requestId,
        message: requestUpdateErr.message,
      });
      warnings.push('Could not update request email status.');
    }

    return jsonResponse({
      ok: true,
      request_id: requestId,
      contacts: contactPayload,
      ...(warnings.length ? { warnings } : {}),
    }, req);
  } catch (err) {
    console.error('submit-contact-request unhandled error', err);
    return jsonResponse({ error: 'Internal server error' }, req, 500);
  }
});
