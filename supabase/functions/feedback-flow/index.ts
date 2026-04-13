import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { stripHtml } from '../_shared/sanitize.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = getAdminClient();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const requestId = url.searchParams.get('request_id');
    const candidateId = url.searchParams.get('candidate_id');
    const token = url.searchParams.get('token');
    if (!requestId || !candidateId || !token) {
      return jsonResponse({ valid: false, error: 'missing_params' }, 400);
    }

    const { data: row, error } = await admin
      .from('feedback_tokens')
      .select('id, expires_at, used_at, requester_id')
      .eq('token', token)
      .eq('request_id', requestId)
      .eq('candidate_id', candidateId)
      .maybeSingle();

    if (error || !row) {
      return jsonResponse({ valid: false });
    }
    if (row.used_at) {
      return jsonResponse({ valid: false, error: 'used' });
    }
    if (new Date(row.expires_at as string) <= new Date()) {
      return jsonResponse({ valid: false, error: 'expired' });
    }

    const { data: cand } = await admin
      .from('profiles')
      .select('reference_number, first_name')
      .eq('id', candidateId)
      .single();

    return jsonResponse({
      valid: true,
      magic: true,
      candidate_label: `${stripHtml(String(cand?.first_name ?? ''), 60)} (${stripHtml(String(cand?.reference_number ?? ''), 20)})`,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: {
    token?: string;
    request_id?: string;
    candidate_id?: string;
    made_contact?: string;
    recommend_retain?: string;
    notes?: string;
    is_flagged?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const requestId = body.request_id;
  const candidateId = body.candidate_id;
  const made_contact = body.made_contact;
  const recommend_retain = body.recommend_retain;
  if (!requestId || !candidateId || !made_contact || !recommend_retain) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }

  const notes = stripHtml(String(body.notes ?? ''), 4000);
  const is_flagged = !!body.is_flagged;

  let requesterId: string | null = null;
  let tokenRowId: string | null = null;

  if (body.token) {
    const { data: tok, error: te } = await admin
      .from('feedback_tokens')
      .select('id, expires_at, used_at, requester_id')
      .eq('token', body.token)
      .eq('request_id', requestId)
      .eq('candidate_id', candidateId)
      .maybeSingle();
    if (te || !tok) {
      return jsonResponse({ error: 'invalid_token' }, 403);
    }
    if (tok.used_at) {
      return jsonResponse({ error: 'token_used' }, 403);
    }
    if (new Date(tok.expires_at as string) <= new Date()) {
      return jsonResponse({ error: 'token_expired' }, 403);
    }
    requesterId = tok.requester_id as string;
    tokenRowId = tok.id as string;
  } else {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const { data: prof } = await admin
      .from('profiles')
      .select('id')
      .eq('auth_user_id', userData.user.id)
      .single();
    if (!prof) {
      return jsonResponse({ error: 'Profile not found' }, 400);
    }
    const myId = prof.id as string;
    const { data: rq } = await admin.from('requests').select('requester_id').eq('id', requestId).single();
    if (!rq || (rq.requester_id as string) !== myId) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }
    requesterId = myId;
  }

  const { error: insErr } = await admin.from('feedback').insert({
    request_id: requestId,
    candidate_id: candidateId,
    requester_id: requesterId,
    made_contact,
    recommend_retain,
    notes: notes || null,
    is_flagged,
  });
  if (insErr) {
    return jsonResponse({ error: insErr.message }, 500);
  }

  if (tokenRowId) {
    await admin.from('feedback_tokens').update({ used_at: new Date().toISOString() }).eq('id', tokenRowId);
  }

  return jsonResponse({ ok: true });
});
