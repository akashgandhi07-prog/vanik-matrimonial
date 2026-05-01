import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { allowFunctionRateLimit, clientIp } from '../_shared/function-rate-limit.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

const COUPON_CHECK_LIMIT = { maxAttempts: 45, windowMs: 60 * 60 * 1000 };

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

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const ip = clientIp(req);
  const rateKey = `${ip.slice(0, 200)}::${userData.user.id}`.slice(0, 480);
  const okLimit = await allowFunctionRateLimit(admin, {
    scope: 'validate-coupon',
    rateKey,
    maxAttempts: COUPON_CHECK_LIMIT.maxAttempts,
    windowMs: COUPON_CHECK_LIMIT.windowMs,
  });
  if (!okLimit) {
    return jsonResponse({ error: 'Too many attempts. Try again later.', code: 'rate_limited' }, req, 429);
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const raw = (body.code ?? '').trim().toUpperCase();
  if (!raw) {
    return jsonResponse({ valid: false }, req);
  }

  const { data: row, error } = await admin
    .from('coupons')
    .select('code, is_active, expires_at, max_uses, use_count, type')
    .eq('code', raw)
    .maybeSingle();

  if (error || !row) {
    return jsonResponse({ valid: false }, req);
  }

  const now = new Date();
  if (!row.is_active) {
    return jsonResponse({ valid: false }, req);
  }
  if (row.expires_at && new Date(row.expires_at) < now) {
    return jsonResponse({ valid: false }, req);
  }
  if (row.max_uses != null && row.use_count >= row.max_uses) {
    return jsonResponse({ valid: false }, req);
  }

  return jsonResponse({ valid: true, kind: row.type }, req);
});
