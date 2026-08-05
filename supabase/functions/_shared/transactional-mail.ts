import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { sendResendEmail, type EmailPayload } from './resend.ts';

// denomailer can raise errors on background microtasks when the SMTP server
// drops the connection mid-send ("Error while in datamode", then
// "BadResource at TlsConn.close"). Those never pass through a try/catch and
// would otherwise kill the whole worker - the gateway then returns 502/503 to
// the browser even though the function's DB writes already committed
// (observed in production on 2026-08-02). Swallow ONLY that specific teardown
// crash at the event-loop level so a mail failure can never crash the function.
// Every other unhandled error must still surface - suppressing them all would
// mask unrelated bugs in any function that transitively imports this module.
function isDenomailerTeardownCrash(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : reason && typeof reason === 'object' && 'message' in reason
          ? String((reason as { message: unknown }).message)
          : String(reason ?? '');
  // Signatures documented above: the datamode write failure and the follow-on
  // BadResource raised while denomailer closes the TLS connection.
  return /while in datamode/i.test(msg) || /BadResource/i.test(msg) || /TlsConn/i.test(msg);
}

globalThis.addEventListener('unhandledrejection', (ev) => {
  if (isDenomailerTeardownCrash(ev.reason)) {
    console.error('transactional-mail: suppressed denomailer SMTP teardown crash:', ev.reason);
    ev.preventDefault();
    return;
  }
  // Not the known mail crash - log it but let it surface so real bugs are not hidden.
  console.error('transactional-mail: passing through unhandled rejection:', ev.reason);
});
globalThis.addEventListener('error', (ev) => {
  const reason = ev.error ?? ev.message;
  if (isDenomailerTeardownCrash(reason)) {
    console.error('transactional-mail: suppressed denomailer SMTP teardown crash:', reason);
    ev.preventDefault();
    return;
  }
  // Not the known mail crash - log it but let it surface so real bugs are not hidden.
  console.error('transactional-mail: passing through uncaught error:', reason);
});

const SMTP_SEND_TIMEOUT_MS = 25_000;

/** Splits comma/semicolon-separated lists (e.g. ADMIN_NOTIFY_EMAIL). */
export function normalizeMailRecipients(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    ),
  ];
}

function readSmtpUser(): string | undefined {
  for (const key of ['SMTP_USER', 'SMTP_USERNAME', 'GMAIL_SMTP_USER'] as const) {
    const t = Deno.env.get(key)?.trim();
    if (t) return t;
  }
  return undefined;
}

function readSmtpPass(): string | undefined {
  for (const key of ['SMTP_PASS', 'SMTP_PASSWORD', 'GMAIL_SMTP_PASS', 'GMAIL_APP_PASSWORD'] as const) {
    const t = Deno.env.get(key)?.trim();
    if (t) return t;
  }
  return undefined;
}

/** True when Edge Functions can send mail (Gmail/custom SMTP or Resend). */
export function isTransactionalMailConfigured(): boolean {
  const smtp = !!(readSmtpUser() && readSmtpPass());
  return smtp || !!Deno.env.get('RESEND_API_KEY');
}

/** Safe diagnostics for admin tooling (no secret values). */
export function transactionalMailRuntimeStatus(): {
  configured: boolean;
  smtp_user_present: boolean;
  smtp_pass_present: boolean;
  resend_present: boolean;
  edge_supabase_host: string | null;
} {
  const u = readSmtpUser();
  const p = readSmtpPass();
  let edge_supabase_host: string | null = null;
  try {
    const raw = Deno.env.get('SUPABASE_URL');
    if (raw) edge_supabase_host = new URL(raw).host;
  } catch {
    edge_supabase_host = null;
  }
  return {
    configured: !!(u && p) || !!Deno.env.get('RESEND_API_KEY'),
    smtp_user_present: !!u,
    smtp_pass_present: !!p,
    resend_present: !!Deno.env.get('RESEND_API_KEY'),
    edge_supabase_host,
  };
}

export function transactionalMailMissingReason(): string {
  if (isTransactionalMailConfigured()) return '';
  const s = transactionalMailRuntimeStatus();
  return `Edge sees smtp_user=${s.smtp_user_present} smtp_pass=${s.smtp_pass_present} resend=${s.resend_present} (functions project host: ${s.edge_supabase_host ?? 'unknown'}). If the dashboard shows SMTP secrets but this is false, your browser app may be calling a different Supabase project; check VITE_SUPABASE_URL matches that host.`;
}

/**
 * Brevo's click/open-tracking rewriter (cannot be disabled on our plan)
 * re-serializes the HTML part without re-escaping literal `=`, so after a
 * client decodes its quoted-printable output, any `=` followed by two hex
 * digits in the raw HTML becomes a stray byte ("width=device-width" ->
 * "width\xDEvice-width"; observed 5 Aug 2026). `&#61;` renders identically
 * in text and quoted attribute values but survives the rewrite. Only `=`
 * followed by 2 hex chars is armored, so markup `="` stays untouched.
 */
export function armorEqualsHexForBrevo(html: string): string {
  return html.replace(/=(?=[0-9A-Fa-f]{2})/g, '&#61;');
}

/**
 * RFC 2045 quoted-printable body, encoded by us. Both library options are
 * broken: denomailer's QP encoder never applies its `=` escaping (the
 * `replaceAll` result is discarded), and its pre-encoded base64 path is
 * mangled by Brevo's tracking rewriter (the first 76-char line of the body
 * is swallowed and no rewrite happens; observed 5 Aug 2026). Brevo parses
 * and re-serializes correctly-encoded QP parts.
 */
export function htmlToQuotedPrintableBody(html: string): string {
  const bytes = new TextEncoder().encode(html.replace(/\r\n|\r|\n/g, '\r\n'));
  let out = '';
  let line = '';
  const encodeTrailingWhitespace = () => {
    if (line.endsWith(' ')) line = `${line.slice(0, -1)}=20`;
    else if (line.endsWith('\t')) line = `${line.slice(0, -1)}=09`;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 13 && bytes[i + 1] === 10) {
      encodeTrailingWhitespace();
      out += `${line}\r\n`;
      line = '';
      i++;
      continue;
    }
    let tok: string;
    if (b === 9) {
      tok = '\t';
    } else if (b === 61 || b < 32 || b > 126) {
      tok = `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
    } else if (b === 46 && line.length === 0) {
      // Leading "." must not reach SMTP DATA unescaped (denomailer does not
      // dot-stuff); "=2E" is equivalent and always safe.
      tok = '=2E';
    } else {
      tok = String.fromCharCode(b);
    }
    if (line.length + tok.length > 75) {
      out += `${line}=\r\n`;
      line = '';
      if (tok === '.') tok = '=2E';
    }
    line += tok;
  }
  encodeTrailingWhitespace();
  return out + line;
}

/**
 * Explicit TLS opt-in for non-465 ports. Returns true/false when SMTP_TLS or
 * SMTP_SECURE is set to a recognised boolean, null when neither is set, and
 * throws on an unrecognised value so a typo can never be read as "plaintext".
 */
function readExplicitTlsSetting(): boolean | null {
  for (const key of ['SMTP_TLS', 'SMTP_SECURE'] as const) {
    const raw = Deno.env.get(key)?.trim().toLowerCase();
    if (raw === undefined || raw === '') continue;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    throw new Error(`Invalid ${key}="${raw}": expected a boolean (true/false).`);
  }
  return null;
}

async function sendViaSmtp(
  payload: { to: string[]; subject: string; html: string }
): Promise<{ id: string | null; error: string | null }> {
  const user = readSmtpUser()!;
  const pass = readSmtpPass()!;
  const host = Deno.env.get('SMTP_HOST')?.trim() || 'smtp.gmail.com';
  const port = Number(Deno.env.get('SMTP_PORT') || '587');
  // Port 465 is implicit TLS - the current production path (Brevo) and always
  // encrypted; it must keep working exactly as before. For any other port, TLS
  // has to be declared explicitly via SMTP_TLS/SMTP_SECURE: we refuse to guess,
  // because a silent plaintext fallback would send the SMTP credentials in the
  // clear. We do NOT attempt STARTTLS on 587 - the denomailer version in use
  // cannot upgrade a plaintext connection reliably.
  let tls: boolean;
  if (port === 465) {
    tls = true;
  } else {
    const explicit = readExplicitTlsSetting();
    if (explicit === null) {
      throw new Error(
        `SMTP_PORT=${port} is not the implicit-TLS port 465. Set SMTP_TLS (or SMTP_SECURE) to true or false to declare whether this connection is encrypted; refusing to send SMTP credentials over an undeclared connection.`
      );
    }
    tls = explicit;
  }
  const fromEmail = Deno.env.get('SMTP_FROM_EMAIL')?.trim() || user;
  const fromName = Deno.env.get('SMTP_FROM_NAME')?.trim() || 'Vanik Matrimonial Register';
  const replyTo = Deno.env.get('SMTP_REPLY_TO')?.trim();

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      tls,
      auth: { username: user, password: pass },
    },
  });

  try {
    // A dropped SMTP connection can leave denomailer waiting forever; cap the
    // whole conversation so background email tasks always finish.
    await Promise.race([
      client.send({
        from: `${fromName} <${fromEmail}>`,
        to: payload.to.length === 1 ? payload.to[0]! : payload.to,
        subject: payload.subject,
        mimeContent: [
          {
            mimeType: 'text/html; charset="utf-8"',
            content: htmlToQuotedPrintableBody(armorEqualsHexForBrevo(payload.html)),
            transferEncoding: 'quoted-printable',
          },
        ],
        ...(replyTo ? { replyTo } : {}),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`SMTP send timed out after ${SMTP_SEND_TIMEOUT_MS}ms`)), SMTP_SEND_TIMEOUT_MS)
      ),
    ]);
    await client.close();
    return { id: null, error: null };
  } catch (e) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return { id: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sends transactional mail. Prefers SMTP (same as Supabase Auth custom SMTP) when
 * `SMTP_USER` + `SMTP_PASS` are set; otherwise uses `RESEND_API_KEY`.
 */
export async function sendTransactionalMail(
  payload: EmailPayload
): Promise<{ id: string | null; error: string | null }> {
  const to = normalizeMailRecipients(payload.to);
  if (!to.length) return { id: null, error: 'No valid recipient email addresses' };

  const user = readSmtpUser();
  const pass = readSmtpPass();
  if (user && pass) {
    return sendViaSmtp({ ...payload, to });
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    const r = await sendResendEmail(resendKey, { ...payload, to });
    if (r.error && /not verified|verify your domain/i.test(r.error)) {
      return {
        id: null,
        error: `${r.error}. If you use Gmail for transactional mail, set Edge secrets SMTP_USER + SMTP_PASS (same app password as Auth SMTP), redeploy functions, and remove RESEND_API_KEY so Resend is not used.`,
      };
    }
    return r;
  }
  return { id: null, error: 'Email not configured (set SMTP_USER + SMTP_PASS or RESEND_API_KEY)' };
}
