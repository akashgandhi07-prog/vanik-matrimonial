import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { allowFunctionRateLimit, clientIp } from '../_shared/function-rate-limit.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

// Anonymous (the invited friend has no account yet), so it is rate limited per
// IP and code. Only a counter row is written: no IP, no user agent, no visitor id.
const REFERRAL_EVENT_LIMIT = { maxAttempts: 120, windowMs: 60 * 60 * 1000 };
const EVENTS = new Set(['open', 'share']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  let body: { code?: unknown; event?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const codeRaw = String(body.code ?? '').trim().toUpperCase();
  const event = String(body.event ?? '');
  // Strict format check also keeps ilike wildcards out of the lookup.
  if (!/^VR-[A-Z2-9]{4,8}$/.test(codeRaw) || !EVENTS.has(event)) {
    return jsonResponse({ error: 'Invalid referral event' }, req, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const ip = clientIp(req);
  const okLimit = await allowFunctionRateLimit(admin, {
    scope: 'record-referral-event',
    rateKey: `${ip.slice(0, 200)}::${codeRaw}`.slice(0, 480),
    maxAttempts: REFERRAL_EVENT_LIMIT.maxAttempts,
    windowMs: REFERRAL_EVENT_LIMIT.windowMs,
  });
  if (!okLimit) {
    // Acknowledge rather than error: the caller is analytics-only and must never
    // show the visitor a problem.
    return jsonResponse({ ok: true }, req, 200);
  }

  const { data: refRow } = await admin
    .from('member_private')
    .select('profile_id')
    .ilike('referral_code', codeRaw)
    .maybeSingle();
  // Unknown codes are acknowledged too, so the endpoint cannot be used to probe codes.
  if (!refRow) {
    return jsonResponse({ ok: true }, req, 200);
  }

  const { error: insErr } = await admin.from('referral_events').insert({
    referrer_profile_id: refRow.profile_id as string,
    event,
  });
  if (insErr) {
    console.error('record-referral-event insert', insErr.message);
  }
  return jsonResponse({ ok: true }, req, 200);
});
