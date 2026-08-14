import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { letterHtml } from '../_shared/resend.ts';
import {
  buildCandidatesHtml,
  buildContactDetail,
  contactDetailsEmailContent,
  introductionReceivedEmailContent,
} from '../_shared/introduction.ts';

/**
 * Read-only admin preview of exactly what two members share when one requests
 * the other's contact details. Computed with the SAME builders the live flow
 * uses (_shared/introduction.ts), so it cannot drift from reality.
 *
 * Strictly a pure read: no requests row, no quota use, no email send, no
 * email_log entry, no admin_actions entry with member-visible effect.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let body: { requester_id?: string; candidate_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }
  const requesterId = body.requester_id ?? '';
  const candidateId = body.candidate_id ?? '';
  if (!UUID_RE.test(requesterId) || !UUID_RE.test(candidateId)) {
    return jsonResponse({ error: 'requester_id and candidate_id are required' }, req, 400);
  }
  if (requesterId === candidateId) {
    return jsonResponse({ error: 'Pick two different members' }, req, 400);
  }

  const admin = getAdminClient();

  const { data: profiles, error: pErr } = await admin
    .from('profiles')
    .select('*')
    .in('id', [requesterId, candidateId]);
  if (pErr) return jsonResponse({ error: pErr.message }, req, 500);

  const requesterProfile = (profiles ?? []).find((p) => p.id === requesterId);
  const candidateProfile = (profiles ?? []).find((p) => p.id === candidateId);
  if (!requesterProfile || !candidateProfile) {
    return jsonResponse({ error: 'One or both members were not found' }, req, 404);
  }

  const { data: privRows, error: mErr } = await admin
    .from('member_private')
    .select('profile_id, surname, mobile_phone, email')
    .in('profile_id', [requesterId, candidateId]);
  if (mErr) return jsonResponse({ error: mErr.message }, req, 500);

  const privById = new Map((privRows ?? []).map((m) => [m.profile_id as string, m]));
  const requesterPriv = privById.get(requesterId);
  const candidatePriv = privById.get(candidateId);

  // What the requester (A) receives about the candidate (B) - and, because an
  // introduction is mutual, what B's "Requested your details" view shows of A.
  const requesterSeesCandidate = buildContactDetail(candidateProfile, candidatePriv);
  const candidateSeesRequester = buildContactDetail(requesterProfile, requesterPriv);

  // The two emails the live flow would send, rendered but NOT sent.
  const contactEmail = contactDetailsEmailContent({
    requesterFirstName: String(requesterProfile.first_name ?? ''),
    requesterEmail: candidateSeesRequester.email,
    candidatesHtml: buildCandidatesHtml([requesterSeesCandidate]),
  });
  const introEmail = introductionReceivedEmailContent({
    recipientFirstName: String(candidateProfile.first_name ?? ''),
    requesterName: candidateSeesRequester.full_name,
    requesterAge: requesterProfile.age != null ? String(requesterProfile.age) : '',
  });

  return jsonResponse(
    {
      requester: { profile: requesterProfile, shared_contact: candidateSeesRequester },
      candidate: { profile: candidateProfile, shared_contact: requesterSeesCandidate },
      emails: {
        contact_details: {
          to: 'requester',
          subject: contactEmail.subject,
          html: letterHtml('Vanik Matrimonial Register', contactEmail.inner),
        },
        introduction_received: {
          to: 'candidate',
          subject: introEmail.subject,
          html: letterHtml('Vanik Matrimonial Register', introEmail.inner),
        },
      },
    },
    req
  );
});
