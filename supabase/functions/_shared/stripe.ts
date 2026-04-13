/** Stripe REST helpers for Edge Functions (no Node SDK). */

export type StripeSessionPurpose = 'registration' | 'renewal';

export async function stripeRetrieveCheckoutSession(
  secretKey: string,
  sessionId: string
): Promise<Record<string, unknown>> {
  const sid = sessionId.trim();
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sid)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message ?? text.slice(0, 200);
    throw new Error(err || `Stripe HTTP ${res.status}`);
  }
  return json;
}

export function sessionMetadata(session: Record<string, unknown>): Record<string, string> {
  const m = session.metadata as Record<string, string> | null | undefined;
  return m && typeof m === 'object' ? m : {};
}

/**
 * Confirms Checkout Session is paid and metadata matches the caller and purpose.
 */
export async function verifyPaidCheckoutSession(args: {
  secretKey: string;
  sessionId: string;
  authUserId: string;
  purpose: StripeSessionPurpose;
}): Promise<{ amount_total: number | null; currency: string | null }> {
  const session = await stripeRetrieveCheckoutSession(args.secretKey, args.sessionId);
  if (session.payment_status !== 'paid') {
    throw new Error('Checkout session is not paid');
  }
  const meta = sessionMetadata(session);
  if (meta.supabase_user_id !== args.authUserId) {
    throw new Error('Checkout session does not belong to this account');
  }
  if (meta.purpose !== args.purpose) {
    throw new Error('Checkout session purpose mismatch');
  }
  const amount_total = typeof session.amount_total === 'number' ? session.amount_total : null;
  const currency = typeof session.currency === 'string' ? session.currency : null;
  return { amount_total, currency };
}
