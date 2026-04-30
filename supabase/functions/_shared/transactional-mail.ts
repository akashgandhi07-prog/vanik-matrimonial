import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { sendResendEmail, type EmailPayload } from './resend.ts';

/** True when Edge Functions can send mail (Gmail/custom SMTP or Resend). */
export function isTransactionalMailConfigured(): boolean {
  const smtp = !!(Deno.env.get('SMTP_USER')?.trim() && Deno.env.get('SMTP_PASS'));
  return smtp || !!Deno.env.get('RESEND_API_KEY');
}

async function sendViaSmtp(payload: EmailPayload): Promise<{ id: string | null; error: string | null }> {
  const user = Deno.env.get('SMTP_USER')!.trim();
  const pass = Deno.env.get('SMTP_PASS')!;
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
      html: payload.html,
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
  const user = Deno.env.get('SMTP_USER')?.trim();
  const pass = Deno.env.get('SMTP_PASS');
  if (user && pass) {
    return sendViaSmtp(payload);
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    return sendResendEmail(resendKey, payload);
  }
  return { id: null, error: 'Email not configured (set SMTP_USER + SMTP_PASS or RESEND_API_KEY)' };
}
