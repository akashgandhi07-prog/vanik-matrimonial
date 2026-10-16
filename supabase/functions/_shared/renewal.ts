/**
 * Applying a paid renewal Checkout Session to a member's profile.
 *
 * Three callers reach this, and any of them may see the same session first:
 * - stripe-webhook, when Stripe delivers checkout.session.completed;
 * - confirm-renewal, when the member lands back on /renew-membership after paying;
 * - reconcile-renewals, the daily sweep of recent paid sessions at Stripe.
 * The stripe_checkout_sessions primary key makes the first writer win; everyone
 * else gets 'already_applied'.
 */
import { getAdminClient } from './dispatch-email.ts';
import {
  EARLY_RENEWAL_BONUS_MONTHS,
  graceEndsAt,
  qualifiesForEarlyRenewalBonus,
} from './membership.ts';

type AdminClient = ReturnType<typeof getAdminClient>;

/**
 * A second paid renewal within this window of one already applied is treated as an
 * accidental repeat (double click, retrying after a slow redirect): it is recorded,
 * with renewal_applied_at left null, but does not add another year. Staff can refund
 * it from admin > Payments.
 */
const DUPLICATE_WINDOW_DAYS = 7;

export type RenewalSession = {
  id: string;
  paymentStatus: string | null;
  metadata: Record<string, string>;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  /** Unix seconds the session was opened. */
  created: number | null;
  customerEmail: string | null;
};

export type RenewalOutcome =
  | { status: 'renewed'; membership_expires_at: string; bonus_months: number }
  | { status: 'already_applied' }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; message: string };

/** Normalises a Checkout Session from the Stripe REST API or a webhook event. */
export function renewalSessionFromStripe(s: Record<string, unknown>): RenewalSession {
  const meta = s.metadata;
  const details = s.customer_details as { email?: string | null } | null | undefined;
  return {
    id: String(s.id ?? ''),
    paymentStatus: typeof s.payment_status === 'string' ? s.payment_status : null,
    metadata: meta && typeof meta === 'object' ? (meta as Record<string, string>) : {},
    amountTotal: typeof s.amount_total === 'number' ? s.amount_total : null,
    currency: typeof s.currency === 'string' ? s.currency : null,
    paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
    created: typeof s.created === 'number' ? s.created : null,
    customerEmail: details?.email ?? (typeof s.customer_email === 'string' ? s.customer_email : null),
  };
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function applyRenewalPayment(admin: AdminClient, session: RenewalSession): Promise<RenewalOutcome> {
  if (session.paymentStatus !== 'paid') return { status: 'skipped', reason: 'not_paid' };
  const meta = session.metadata;
  if (meta.purpose !== 'renewal') return { status: 'skipped', reason: 'not_renewal' };
  const authUserId = meta.supabase_user_id;
  const profileId = meta.profile_id;
  if (!session.id || typeof authUserId !== 'string') return { status: 'skipped', reason: 'bad_metadata' };
  if (typeof profileId !== 'string') return { status: 'skipped', reason: 'no_profile_id' };

  const { data: prof, error: pe } = await admin
    .from('profiles')
    .select('id, auth_user_id, membership_expires_at, status, hidden_reason')
    .eq('id', profileId)
    .maybeSingle();
  if (pe || !prof || (prof.auth_user_id as string) !== authUserId) {
    return { status: 'skipped', reason: 'profile_mismatch' };
  }

  // Belt-and-braces: warn if Stripe customer_email doesn't match registered email
  if (session.customerEmail) {
    const { data: privRow } = await admin
      .from('member_private')
      .select('email')
      .eq('profile_id', profileId)
      .maybeSingle();
    const registeredEmail = privRow?.email as string | null | undefined;
    if (registeredEmail && registeredEmail.toLowerCase() !== session.customerEmail.toLowerCase()) {
      console.warn(
        `renewal: customer_email ${session.customerEmail} does not match registered email ${registeredEmail} for profile ${profileId} - proceeding (authUserId check passed)`
      );
    }
  }

  const st = prof.status as string;
  const renewable = new Set(['active', 'expired', 'closed']);
  if (!renewable.has(st)) return { status: 'skipped', reason: 'bad_status' };

  const now = new Date();
  const windowStart = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 864e5).toISOString();
  const { data: recent, error: recentErr } = await admin
    .from('stripe_checkout_sessions')
    .select('checkout_session_id')
    .eq('profile_id', profileId)
    .eq('purpose', 'renewal')
    .neq('checkout_session_id', session.id)
    .gt('renewal_applied_at', windowStart)
    .limit(1);
  if (recentErr) return { status: 'error', message: recentErr.message };
  const isDuplicate = (recent ?? []).length > 0;

  const appliedAt = now.toISOString();
  const { error: insErr } = await admin.from('stripe_checkout_sessions').insert({
    checkout_session_id: session.id,
    auth_user_id: authUserId,
    profile_id: profileId,
    purpose: 'renewal',
    payment_status: 'paid',
    amount_total: session.amountTotal,
    currency: session.currency,
    payment_intent_id: session.paymentIntentId,
    renewal_applied_at: isDuplicate ? null : appliedAt,
    updated_at: appliedAt,
  });
  if (insErr) {
    if (insErr.code === '23505') return { status: 'already_applied' };
    console.error('stripe_checkout_sessions insert renewal', insErr);
    return { status: 'error', message: insErr.message };
  }

  if (isDuplicate) {
    console.warn(
      `renewal: session ${session.id} is a repeat payment for profile ${profileId} within ${DUPLICATE_WINDOW_DAYS} days - recorded, membership not extended again`
    );
    return { status: 'duplicate' };
  }

  const curExp = prof.membership_expires_at ? new Date(prof.membership_expires_at as string) : null;
  // Renewing during the grace period continues from the old expiry date: the grace
  // days are a courtesy, not extra paid time. After grace, the new year starts today.
  const start = curExp && graceEndsAt(curExp) > now ? curExp : now;
  // Judge "early" by when checkout was opened, so finishing payment just after
  // midnight on the last day (or being applied later by the daily sweep) still
  // earns the bonus month the reminder promised.
  const openedAt = session.created ? new Date(session.created * 1000) : now;
  const bonusMonths = qualifiesForEarlyRenewalBonus(curExp, openedAt) ? EARLY_RENEWAL_BONUS_MONTHS : 0;
  const newExp = addMonths(start, 12 + bonusMonths);

  const { error: upErr } = await admin
    .from('profiles')
    .update({
      membership_expires_at: newExp.toISOString(),
      status: 'active',
      // Renewing clears a matched flag -- they are coming back -- but must not undo a
      // member's own pause or a staff hide. A payment is not a moderation override.
      hidden_reason: prof.hidden_reason === 'matched' ? null : prof.hidden_reason,
      delete_after: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId);

  if (upErr) {
    // Do NOT delete the session record - deleting causes Stripe to retry, which re-inserts,
    // fails again, deletes again, creating an infinite retry loop.
    // Leaving the record in place means the next attempt hits the 23505 idempotency check.
    // The payment record is preserved for manual recovery.
    console.error('profile renewal update failed - payment recorded, membership NOT extended', upErr);
    return { status: 'error', message: upErr.message };
  }

  return { status: 'renewed', membership_expires_at: newExp.toISOString(), bonus_months: bonusMonths };
}
