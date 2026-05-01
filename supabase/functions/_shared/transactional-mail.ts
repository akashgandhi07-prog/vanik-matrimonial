import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { sendResendEmail, type EmailPayload } from './resend.ts';

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
  return `Edge sees smtp_user=${s.smtp_user_present} smtp_pass=${s.smtp_pass_present} resend=${s.resend_present} (functions project host: ${s.edge_supabase_host ?? 'unknown'}). If the dashboard shows SMTP secrets but this is false, your browser app may be calling a different Supabase project—check VITE_SUPABASE_URL matches that host.`;
}

/** Base64 body with 76-char lines; avoids denomailer's quoted-printable (=20 before line breaks). */
function htmlToBase64MimeBody(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const raw = btoa(binary);
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += 76) {
    lines.push(raw.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

async function sendViaSmtp(payload: EmailPayload): Promise<{ id: string | null; error: string | null }> {
  const user = readSmtpUser()!;
  const pass = readSmtpPass()!;
  const host = Deno.env.get('SMTP_HOST')?.trim() || 'smtp.gmail.com';
  const port = Number(Deno.env.get('SMTP_PORT') || '587');
  const tls = port === 465;
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
    await client.send({
      from: `${fromName} <${fromEmail}>`,
      to: payload.to,
      subject: payload.subject,
      mimeContent: [
        {
          mimeType: 'text/html; charset="utf-8"',
          content: htmlToBase64MimeBody(payload.html),
          transferEncoding: 'base64',
        },
      ],
      ...(replyTo ? { replyTo } : {}),
    });
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
  const user = readSmtpUser();
  const pass = readSmtpPass();
  if (user && pass) {
    return sendViaSmtp(payload);
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    const r = await sendResendEmail(resendKey, payload);
    if (r.error && /not verified|verify your domain/i.test(r.error)) {
      return {
        id: null,
        error: `${r.error} — If you use Gmail for transactional mail, set Edge secrets SMTP_USER + SMTP_PASS (same app password as Auth SMTP), redeploy functions, and remove RESEND_API_KEY so Resend is not used.`,
      };
    }
    return r;
  }
  return { id: null, error: 'Email not configured (set SMTP_USER + SMTP_PASS or RESEND_API_KEY)' };
}
