/**
 * Membership dates: grace period, early-renewal bonus and London calendar days.
 *
 * A membership "ends" on membership_expires_at, but the member keeps full access
 * (listed in browse, can make requests) for MEMBERSHIP_GRACE_DAYS afterwards so a
 * late renewal never drops them off the register. expire-memberships only flips
 * status to 'expired' once the grace period is over.
 *
 * Keep MEMBERSHIP_GRACE_DAYS in step with src/lib/memberStatus.ts and
 * public.membership_is_current() (migration 20261011120000_membership_grace_and_renewal_funnel).
 */
export const MEMBERSHIP_GRACE_DAYS = 14;

/** Extra months added when a member pays on or before the day their membership ends. */
export const EARLY_RENEWAL_BONUS_MONTHS = 1;

const DAY_MS = 864e5;

/** Last moment of access: the expiry date plus the grace period. */
export function graceEndsAt(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() + MEMBERSHIP_GRACE_DAYS * DAY_MS);
}

/** ISO cutoff for queries: a member has access while membership_expires_at > this. */
export function membershipAccessCutoffIso(now = new Date()): string {
  return new Date(now.getTime() - MEMBERSHIP_GRACE_DAYS * DAY_MS).toISOString();
}

/** True while the membership is current or inside its grace period. */
export function hasMembershipAccess(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return graceEndsAt(new Date(expiresAt)) > now;
}

/** YYYY-MM-DD of this instant in the UK. */
export function londonDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Whole UK calendar days from `from` to `to` (0 = same day, negative = `to` is in the past). */
export function londonDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${londonDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${londonDateKey(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** "22 October 2026" (or "22 October" with withYear false), in UK time. */
export function formatLondonDate(d: Date, withYear = true): string {
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Paying on or before the UK calendar day the membership ends earns the bonus month. */
export function qualifiesForEarlyRenewalBonus(expiresAt: Date | null, paidAt: Date): boolean {
  if (!expiresAt) return false;
  return londonDaysBetween(paidAt, expiresAt) >= 0;
}
