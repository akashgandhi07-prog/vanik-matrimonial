import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';
import { stripHtml } from '../_shared/sanitize.ts';

const TO_EMAIL = 'matrimonial@vanikcouncil.uk';
const FIELD_MAX = 4000;
const EMAIL_MAX = 254;

function roughEmailOk(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= EMAIL_MAX;
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

  let body: {
    how_improve?: string;
    things_good?: string;
    things_bad?: string;
    suggestions_future?: string;
    reporter_email?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const how_improve = stripHtml(String(body.how_improve ?? ''), FIELD_MAX) || '';
  const things_good = stripHtml(String(body.things_good ?? ''), FIELD_MAX) || '';
  const things_bad = stripHtml(String(body.things_bad ?? ''), FIELD_MAX) || '';
  const suggestions_future = stripHtml(String(body.suggestions_future ?? ''), FIELD_MAX) || '';

  let reporter_email = stripHtml(String(body.reporter_email ?? ''), EMAIL_MAX).trim().toLowerCase();
  if (reporter_email && !roughEmailOk(reporter_email)) {
    return jsonResponse({ error: 'invalid_email' }, req, 400);
  }

  if (!how_improve && !things_good && !things_bad && !suggestions_future) {
    return jsonResponse({ error: 'empty_feedback' }, req, 400);
  }

  const admin = getAdminClient();
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  let profile_id: string | null = null;
  let membership_email: string | null = null;
  let member_name = '';
  let member_ref = '';

  const { data: userData } = await userClient.auth.getUser();
  const uid = userData.user?.id;
  if (uid) {
    const { data: prof } = await admin
      .from('profiles')
      .select('id, first_name, reference_number')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (prof?.id) {
      profile_id = prof.id as string;
      member_name = stripHtml(String(prof.first_name ?? ''), 80);
      member_ref = stripHtml(String(prof.reference_number ?? ''), 32);
      const { data: priv } = await admin
        .from('member_private')
        .select('email')
        .eq('profile_id', profile_id)
        .maybeSingle();
      membership_email = (priv?.email as string | null)?.trim() || null;
    }
  }

  if (profile_id) {
    reporter_email = '';
  }

  const submitted_at = new Date().toISOString();

  const { data: inserted, error: insErr } = await admin
    .from('website_feedback')
    .insert({
      profile_id,
      reporter_email: reporter_email || null,
      how_improve: how_improve || null,
      things_good: things_good || null,
      things_bad: things_bad || null,
      suggestions_future: suggestions_future || null,
      submitted_at,
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    return jsonResponse({ error: insErr?.message ?? 'insert_failed' }, req, 500);
  }

  const mail = await dispatchEmail(admin, {
    type: 'website_feedback_submission',
    recipientEmail: TO_EMAIL,
    extraData: {
      feedback_id: inserted.id as string,
      submitted_iso: submitted_at,
      profile_id,
      reporter_email: reporter_email || null,
      membership_email,
      member_ref,
      member_name,
      how_improve,
      things_good,
      things_bad,
      suggestions_future,
    },
  });

  return jsonResponse(
    {
      ok: true,
      id: inserted.id,
      email_sent: !!mail.ok,
    },
    req
  );
});
