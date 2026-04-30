export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

function fromAddress(): string {
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')?.trim();
  const fromName = Deno.env.get('RESEND_FROM_NAME')?.trim() || 'Vanik Matrimonial Register';
  if (!fromEmail) {
    // Backward-compatible fallback so existing environments keep working.
    return 'Vanik Matrimonial Register <mahesh.gandhi@vanikcouncil.uk>';
  }
  return `${fromName} <${fromEmail}>`;
}

export async function sendResendEmail(
  apiKey: string,
  payload: EmailPayload
): Promise<{ id: string | null; error: string | null }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [payload.to],
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

export function letterHtml(title: string, innerHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px;background:#f9fafb;font-family:Inter,Segoe UI,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 32px;">
    <p style="margin:0 0 16px;font-weight:600;color:#4f46e5;">${title}</p>
    ${innerHtml}
    <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">Vanik Council · Vanik Matrimonial Register</p>
  </div>
</body></html>`;
}
