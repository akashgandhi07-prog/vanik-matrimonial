import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { allowFunctionRateLimit } from '../_shared/function-rate-limit.ts';
import { stripHtml } from '../_shared/sanitize.ts';

/**
 * Records a client-side failure against the short code the member was shown, so support can look up
 * what actually happened without the app printing config details on screen.
 *
 * Accepts anon or member JWTs: the failures worth logging are exactly the ones where the session or
 * profile could not be read. Identity is taken from the token, never from the request body.
 */

const CODE_RE = /^VMR-[A-Z0-9]{6}$/;
const AREA_MAX = 60;
const MESSAGE_MAX = 500;
const URL_MAX = 300;
const UA_MAX = 300;
const DETAIL_MAX_CHARS = 4000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: {
    error_code?: string;
    area?: string;
    message?: string;
    detail?: Record<string, unknown>;
    page_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const error_code = String(body.error_code ?? '').trim().toUpperCase();
  if (!CODE_RE.test(error_code)) {
    return jsonResponse({ error: 'invalid_code' }, req, 400);
  }

  const area = stripHtml(String(body.area ?? ''), AREA_MAX).trim() || 'unknown';
  const message = stripHtml(String(body.message ?? ''), MESSAGE_MAX).trim() || null;
  const page_url = stripHtml(String(body.page_url ?? ''), URL_MAX).trim() || null;
  const user_agent = stripHtml(req.headers.get('User-Agent') ?? '', UA_MAX).trim() || null;

  let detail: Record<string, unknown> = {};
  if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
    const raw = JSON.stringify(body.detail);
    detail = raw.length > DETAIL_MAX_CHARS ? { truncated: raw.slice(0, DETAIL_MAX_CHARS) } : body.detail;
  }

  // Identify the caller from the JWT when there is one. A missing/expired token is itself useful
  // diagnostic information, so keep logging in that case rather than rejecting.
  let auth_user_id: string | null = null;
  let user_email: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (userData.user) {
      auth_user_id = userData.user.id;
      user_email = userData.user.email ?? null;
    }
  }

  const rateKey = auth_user_id ?? (req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'anon');
  const allowed = await allowFunctionRateLimit(admin, {
    scope: 'log-client-error',
    rateKey,
    maxAttempts: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    // Still hand the code back: the member sees a stable reference either way.
    return jsonResponse({ ok: true, error_code, throttled: true }, req);
  }

  let profile_id: string | null = null;
  if (auth_user_id) {
    const { data: prof } = await admin
      .from('profiles')
      .select('id')
      .eq('auth_user_id', auth_user_id)
      .maybeSingle();
    profile_id = (prof?.id as string | undefined) ?? null;
  }

  const { error: insErr } = await admin.from('client_error_log').insert({
    error_code,
    area,
    message,
    detail,
    auth_user_id,
    profile_id,
    user_email,
    page_url,
    user_agent,
  });

  if (insErr) {
    console.error('client_error_log insert', insErr.message);
    return jsonResponse({ error: 'insert_failed' }, req, 500);
  }

  return jsonResponse({ ok: true, error_code }, req);
});
