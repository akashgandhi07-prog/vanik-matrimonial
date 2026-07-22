import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { allowFunctionRateLimit } from '../_shared/function-rate-limit.ts';
import { stripHtml } from '../_shared/sanitize.ts';
import { sendTransactionalMail } from '../_shared/transactional-mail.ts';
import { letterHtml } from '../_shared/resend.ts';

/** Plain-English explanation of each error `area`, included in the alert email. */
function areaMeaning(area: string): string {
  switch (area) {
    case 'react_render_crash':
      return 'A page crashed while rendering, so the member saw the fallback "Something went wrong" screen instead of the page. Usually a front-end bug tied to a specific page or a bad bit of data.';
    case 'member_profile_load':
      return 'A signed-in member\'s profile could not be loaded, so they saw the "Could not load your account" screen. Often a brief network or session hiccup; if the same member keeps hitting it, investigate.';
    case 'member_contacts_load':
      return 'A member opened their Requests page but the requested contact details would not load (a database function or edge function failed). Their existing request history still showed.';
    default:
      return 'A client-side error was recorded. See the technical detail below and the admin error log for the full context.';
  }
}

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

  // Best-effort alert email. Never affects the response, and is flood-protected so a burst of
  // errors (e.g. an outage where many members fail at once) cannot fill the inbox:
  //   - the same `area` sends at most one email per 15 minutes (repeats collapse), and
  //   - a hard global cap limits total alerts per hour.
  // The admin error log always holds the complete, un-throttled picture.
  try {
    const alertTo = Deno.env.get('ERROR_ALERT_EMAIL')?.trim() || 'akashgandhi07@gmail.com';
    const perAreaOk = await allowFunctionRateLimit(admin, {
      scope: `error-alert:${area}`,
      rateKey: 'all',
      maxAttempts: 1,
      windowMs: 15 * 60 * 1000,
    });
    const globalOk = perAreaOk
      ? await allowFunctionRateLimit(admin, {
          scope: 'error-alert:_global',
          rateKey: 'all',
          maxAttempts: 20,
          windowMs: 60 * 60 * 1000,
        })
      : false;

    if (perAreaOk && globalOk) {
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let detailStr = '{}';
      try {
        detailStr = JSON.stringify(detail, null, 2).slice(0, 1500);
      } catch {
        /* keep default */
      }
      const rows: [string, string][] = [
        ['Reference', error_code],
        ['What it means', areaMeaning(area)],
        ['Area', area],
        ['Message', message ?? '(none)'],
        ['Page', page_url ?? '(unknown)'],
        ['Member', user_email ?? (auth_user_id ?? 'signed out / unknown')],
        ['Browser', user_agent ?? '(unknown)'],
      ];
      const table = rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(
              k,
            )}</td><td style="padding:4px 0;color:#111827">${esc(String(v))}</td></tr>`,
        )
        .join('');
      const inner = `
        <p style="margin:0 0 16px">An error was recorded on the Vanik Matrimonial Register.</p>
        <table style="border-collapse:collapse;font-size:14px;width:100%">${table}</table>
        <p style="margin:20px 0 6px;font-size:13px;color:#6b7280">Technical detail</p>
        <pre style="margin:0;padding:12px;background:#f3f4f6;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word">${esc(
          detailStr,
        )}</pre>
        <p style="margin:18px 0 0;font-size:12px;color:#9ca3af">Repeats of this same error type are suppressed for 15 minutes. The full history is in Admin &rarr; Error log.</p>`;
      const sent = await sendTransactionalMail({
        to: alertTo,
        subject: `[Vanik error] ${error_code} - ${area}`,
        html: letterHtml('Site error alert', inner),
      });
      if (sent.error) console.error('error-alert email', sent.error);
    }
  } catch (e) {
    console.error('error-alert email', e instanceof Error ? e.message : String(e));
  }

  return jsonResponse({ ok: true, error_code }, req);
});
