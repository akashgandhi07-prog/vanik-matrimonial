/**
 * Emails a short operational alert to whoever looks after the site, so that a
 * failure in a background path (Stripe webhook, renewal sweep, account purge) is
 * noticed the same day instead of failing silently for weeks.
 *
 * Recipient: OPS_ALERT_EMAIL, falling back to ADMIN_NOTIFY_EMAIL. Never throws.
 */
import { letterHtml } from './resend.ts';
import { publicSiteBaseUrl } from './site-url.ts';
import { sendTransactionalMail } from './transactional-mail.ts';

export async function sendOpsAlert(subject: string, lines: string[]): Promise<void> {
  const to =
    Deno.env.get('OPS_ALERT_EMAIL')?.trim() ||
    Deno.env.get('ADMIN_NOTIFY_EMAIL')?.trim() ||
    'mahesh.gandhi@vanikcouncil.uk';
  const items = lines.map((l) => `<li>${l}</li>`).join('');
  const html = letterHtml(
    'System alert',
    `<p>Something needs a look on the Vanik Matrimonial Register:</p>
     <ul>${items}</ul>
     <p><a href="${publicSiteBaseUrl()}/admin">Open admin dashboard</a></p>`,
  );
  try {
    const { error } = await sendTransactionalMail({ to, subject: `[Vanik alert] ${subject}`, html });
    if (error) console.error('ops alert send failed:', error);
  } catch (e) {
    console.error('ops alert send threw:', e instanceof Error ? e.message : e);
  }
}

export function escapeAlertText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
