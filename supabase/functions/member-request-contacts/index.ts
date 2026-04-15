import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

type RequestRow = {
  id: string;
  candidate_ids: string[] | null;
};

type ProfileRow = {
  id: string;
  first_name: string;
  reference_number: string | null;
};

type MemberPrivateRow = {
  profile_id: string;
  surname: string | null;
  mobile_phone: string | null;
  email: string | null;
  father_name: string | null;
  mother_name: string | null;
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

  let body: { request_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // Allow empty body.
  }

  const requestIds = Array.isArray(body.request_ids)
    ? [...new Set(body.request_ids.filter(Boolean))]
    : [];

  const admin = getAdminClient();

  const { data: requester, error: requesterErr } = await admin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', userData.user.id)
    .single();
  if (requesterErr || !requester) {
    return jsonResponse({ error: 'Profile not found' }, req, 400);
  }

  let requestQuery = admin
    .from('requests')
    .select('id, candidate_ids')
    .eq('requester_id', requester.id)
    .order('created_at', { ascending: false });
  if (requestIds.length > 0) {
    requestQuery = requestQuery.in('id', requestIds);
  }
  const { data: requestRows, error: requestErr } = await requestQuery;
  if (requestErr) {
    return jsonResponse({ error: requestErr.message }, req, 500);
  }

  const rows = (requestRows ?? []) as RequestRow[];
  const candidateIdSet = new Set<string>();
  for (const row of rows) {
    for (const id of row.candidate_ids ?? []) candidateIdSet.add(id);
  }
  const candidateIds = [...candidateIdSet];

  if (candidateIds.length === 0) {
    return jsonResponse({ contacts_by_request: {} }, req);
  }

  const { data: profileRows, error: profileErr } = await admin
    .from('profiles')
    .select('id, first_name, reference_number')
    .in('id', candidateIds);
  if (profileErr) {
    return jsonResponse({ error: profileErr.message }, req, 500);
  }

  const { data: privateRows, error: privateErr } = await admin
    .from('member_private')
    .select('profile_id, surname, mobile_phone, email, father_name, mother_name')
    .in('profile_id', candidateIds);
  if (privateErr) {
    return jsonResponse({ error: privateErr.message }, req, 500);
  }

  const profileById = new Map((profileRows ?? []).map((p) => [p.id as string, p as ProfileRow]));
  const privateById = new Map(
    (privateRows ?? []).map((m) => [m.profile_id as string, m as MemberPrivateRow])
  );

  const contactsByRequest: Record<string, Array<Record<string, string>>> = {};
  for (const row of rows) {
    contactsByRequest[row.id] = (row.candidate_ids ?? []).map((candidateId) => {
      const profile = profileById.get(candidateId);
      const priv = privateById.get(candidateId);
      const firstName = stripHtml(profile?.first_name ?? 'Member', 80);
      const surname = stripHtml(priv?.surname ?? '', 80);
      const fullName = `${firstName}${surname ? ` ${surname}` : ''}`;
      return {
        profile_id: candidateId,
        first_name: firstName,
        full_name: fullName,
        reference_number: stripHtml(profile?.reference_number ?? '', 20),
        mobile: stripHtml(priv?.mobile_phone ?? '', 40),
        email: stripHtml(priv?.email ?? '', 120),
        father_name: stripHtml(priv?.father_name ?? '', 120),
        mother_name: stripHtml(priv?.mother_name ?? '', 120),
      };
    });
  }

  return jsonResponse({ contacts_by_request: contactsByRequest }, req);
});
