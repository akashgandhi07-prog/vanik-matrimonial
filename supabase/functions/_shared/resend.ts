/** Outbound transactional message. Prefer `sendTransactionalMail`; it parses `to` lists. */
export type EmailPayload = {
  /** One address, or several separated by commas/semicolons (parsed by sendTransactionalMail). */
  to: string;
  subject: string;
  html: string;
};

function fromAddress(): string {
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')?.trim();
  const fromName = Deno.env.get('RESEND_FROM_NAME')?.trim() || 'Vanik Matrimonial Register';
  if (!fromEmail) {
    // Backward-compatible fallback so existing environments keep working.
    return 'Vanik Matrimonial Register <matrimonial@vanikcouncil.uk>';
  }
  return `${fromName} <${fromEmail}>`;
}

export async function sendResendEmail(
  apiKey: string,
  payload: { to: string[]; subject: string; html: string }
): Promise<{ id: string | null; error: string | null }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });
  const data = (await res.json()) as { id?: string; message?: string };
  if (!res.ok) {
    return { id: null, error: data.message ?? res.statusText };
  }
  return { id: data.id ?? null, error: null };
}

/**
 * Shared letter layout for every transactional email. Warm burgundy/gold/cream
 * to match the site brand (see :root palette in src/index.css). Email-safe:
 * inline styles only, single 560px column, no external assets.
 */
export function letterHtml(title: string, innerHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f5f1ea;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.65;color:#1c2230;">
  <div style="display:none;font-size:1px;color:#f5f1ea;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${title}</div>
  <div style="padding:32px 16px;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:#7b2e3b;border-radius:14px 14px 0 0;padding:22px 32px;text-align:center;">
        <div style="display:inline-block;width:38px;height:38px;line-height:38px;border-radius:10px;background:#5f2230;color:#e5b869;font-size:20px;font-weight:bold;margin-bottom:8px;">V</div>
        <div style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:0.02em;">Vanik Matrimonial Register</div>
        <div style="color:#e5b869;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;margin-top:4px;">Vanik Council</div>
      </div>
      <div style="height:3px;background:#b07d2b;"></div>
      <div style="background:#ffffff;border:1px solid #e8e1d6;border-top:none;border-radius:0 0 14px 14px;padding:30px 32px;">
        <p style="margin:0 0 18px;font-size:17px;font-weight:bold;color:#7b2e3b;">${title}</p>
        ${innerHtml}
      </div>
      <div style="text-align:center;padding:20px 24px 8px;font-family:Inter,'Segoe UI',system-ui,sans-serif;">
        <p style="margin:0;font-size:12px;color:#5b6475;">Vanik Council &middot; Vanik Matrimonial Register</p>
        <p style="margin:6px 0 0;font-size:12px;color:#5b6475;">Questions? Just reply to this email or write to <a href="mailto:matrimonial@vanikcouncil.uk" style="color:#7b2e3b;">matrimonial@vanikcouncil.uk</a></p>
      </div>
    </div>
  </div>
</body></html>`;
}
