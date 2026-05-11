/** One-way HMAC-SHA256 (hex); used only when `REGISTRATION_CONSENT_IP_HMAC_SECRET` is set on Edge Functions. */

export async function hashRegistrationSubmitIp(ip: string, secret: string | undefined): Promise<string | null> {
  const s = secret?.trim();
  if (!s) return null;
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed || trimmed === 'unknown') return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(trimmed));
  const bytes = new Uint8Array(sig);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
