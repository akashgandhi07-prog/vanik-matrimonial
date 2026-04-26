import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable `code` for clients; `error` duplicates `code` for older callers. */
function jsonErr(
  req: Request,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return jsonResponse({ error: code, code, message, ...extra }, req, status);
}

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
      return jsonErr(req, 405, 'method_not_allowed', 'Method not allowed');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonErr(req, 401, 'unauthorized', 'Unauthorized');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonErr(req, 401, 'unauthorized', 'Unauthorized');
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonErr(req, 400, 'invalid_json', 'Invalid JSON');
    }
    if (!rawBody || typeof rawBody !== 'object') {
      return jsonErr(req, 400, 'invalid_json_body', 'Invalid JSON body');
    }
    const candidateInput = (rawBody as { candidate_ids?: unknown }).candidate_ids;
    if (!Array.isArray(candidateInput)) {
      return jsonErr(req, 400, 'candidate_ids_not_array', 'candidate_ids must be an array');
    }
    const parsedIds: string[] = [];
    for (const rawId of candidateInput) {
      if (typeof rawId !== 'string') {
        return jsonErr(req, 400, 'candidate_ids_invalid_type', 'candidate_ids must contain only strings');
      }
      const id = rawId.trim();
      if (!id || !UUID_RE.test(id)) {
        return jsonErr(req, 400, 'candidate_ids_invalid_uuid', 'candidate_ids contains an invalid profile id');
      }
      parsedIds.push(id);
    }

    const ids = [...new Set(parsedIds)];
    if (ids.length === 0) {
      return jsonErr(req, 400, 'candidates_required', 'candidates required');
    }
    if (ids.length > 3) {
      return jsonErr(req, 400, 'max_candidates_per_request', 'You can request up to 3 candidates at a time.');
    }

    const admin = getAdminClient();

    const { data: requester, error: reErr } = await admin
      .from('profiles')
      .select('id, first_name, gender, seeking_gender, reference_number, status, membership_expires_at')
      .eq('auth_user_id', userData.user.id)
      .single();
    if (reErr || !requester) {
      return jsonErr(req, 404, 'profile_not_found', 'Profile not found');
    }

    if (
      requester.status !== 'active' ||
      !requester.membership_expires_at ||
      new Date(requester.membership_expires_at) <= new Date()
    ) {
      return jsonErr(req, 403, 'membership_not_active', 'Membership not active');
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
        return jsonErr(
          req,
          409,
          'feedback_required',
          'Outstanding feedback required before new requests. Please complete feedback for introductions older than 21 days.',
          { request_ids: [...outstandingRequestIds] }
        );
      }
    }

    const now = new Date();
    const { data: candProfiles, error: cpErr } = await admin
      .from('profiles')
      .select('id, first_name, gender, reference_number, status, show_on_register, membership_expires_at')
      .in('id', ids);
    if (cpErr) {
      return jsonErr(req, 500, 'candidate_query_failed', cpErr.message);
    }
    const byId = new Map((candProfiles ?? []).map((p) => [(p as ProfileCandidate).id, p as ProfileCandidate]));

    for (const cid of ids) {
      const p = byId.get(cid);
      if (!p) {
        return jsonErr(req, 400, 'invalid_candidate', 'One or more profiles could not be found.');
      }
      const seek =
        (requester as { seeking_gender?: string }).seeking_gender ??
        (requester.gender === 'Female' ? 'Male' : 'Female');
      if (seek !== 'Both' && seek !== p.gender) {
        return jsonErr(
          req,
          400,
          'invalid_candidate',
          'This profile does not match who you are looking for. Change it under Browse or My profile, then try again.'
        );
      }
      if (p.status !== 'active') {
        return jsonErr(
          req,
          400,
          'invalid_candidate',
          'This profile is not available for contact requests.'
        );
      }
      if (!p.show_on_register) {
        return jsonErr(req, 400, 'invalid_candidate', 'This profile is not listed on the register.');
      }
      if (!p.membership_expires_at || new Date(p.membership_expires_at) <= now) {
        return jsonErr(req, 400, 'invalid_candidate', 'This member’s membership is not active.');
      }
    }

    const { data: candPrivate, error: mpErr } = await admin
      .from('member_private')
      .select('*')
      .in('profile_id', ids);
    if (mpErr) {
      return jsonErr(req, 500, 'candidate_private_query_failed', mpErr.message);
    }
    const privateById = new Map(
      (candPrivate ?? []).map((m) => [m.profile_id as string, m as Record<string, unknown>])
    );

    for (const cid of ids) {
      const m = privateById.get(cid);
      if (!m) {
        return jsonErr(
          req,
          500,
          'candidate_data_incomplete',
          'We could not load full details for one profile. Please try again or contact support.'
        );
      }
    }

    const { data: requestInsert, error: requestInsertErr } = await admin.rpc('create_contact_request_atomic', {
      p_requester_id: requester.id,
      p_candidate_ids: ids,
    });
    if (requestInsertErr) {
      console.error('create_contact_request_atomic failed', requestInsertErr);
      return jsonErr(req, 500, 'create_request_failed', requestInsertErr.message);
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
      return jsonErr(req, 500, 'insert_failed', 'Insert failed');
    }
    if (insertRow.error_code) {
      if (insertRow.error_code === 'already_requested_this_week') {
        return jsonErr(
          req,
          409,
          'already_requested_this_week',
          insertRow.error_message ??
            'You already requested this profile within the last 7 days. You can ask again after that window, subject to weekly limits.'
        );
      }
      if (insertRow.error_code === 'weekly_limit') {
        return jsonErr(
          req,
          409,
          'weekly_limit',
          insertRow.error_message ?? 'Weekly limit reached.',
          {
            slots_remaining: insertRow.slots_remaining ?? 0,
            reset_at: insertRow.reset_at ?? null,
          }
        );
      }
      if (insertRow.error_code === 'monthly_limit') {
        return jsonErr(
          req,
          409,
          'monthly_limit',
          insertRow.error_message ?? 'Monthly limit reached.',
          {
            slots_remaining: insertRow.slots_remaining ?? 0,
            reset_at: insertRow.reset_at ?? null,
          }
        );
      }
      return jsonErr(
        req,
        409,
        insertRow.error_code,
        insertRow.error_message ?? 'Request could not be created.'
      );
    }
    if (!insertRow.request_id) {
      return jsonErr(req, 500, 'insert_failed', 'Insert failed');
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
    return jsonErr(req, 500, 'internal_error', 'Internal server error');
  }
});
