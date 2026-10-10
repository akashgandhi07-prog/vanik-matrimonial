/**
 * Days a member keeps full access after membership_expires_at. Keep in step with
 * supabase/functions/_shared/membership.ts and public.membership_is_current().
 */
export const MEMBERSHIP_GRACE_DAYS = 14;

/** Last moment of access: the expiry date plus the grace period. */
export function membershipGraceEndsAt(expiresAt: string | Date): Date {
  return new Date(new Date(expiresAt).getTime() + MEMBERSHIP_GRACE_DAYS * 86400000);
}

/** True while the membership is current or inside its grace period. */
export function hasMembershipAccess(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return membershipGraceEndsAt(expiresAt) > new Date();
}

/** True when the membership date has passed but the grace period has not. */
export function isInMembershipGrace(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) <= new Date() && hasMembershipAccess(expiresAt);
}

/** YYYY-MM-DD of this instant in the UK. */
function londonDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Whole UK calendar days from now until `to` (0 = today, negative = already passed). */
export function londonDaysUntil(to: string | Date): number {
  const a = Date.parse(`${londonDateKey(new Date())}T00:00:00Z`);
  const b = Date.parse(`${londonDateKey(new Date(to))}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Paying on or before the UK day the membership ends adds a free month (see stripe-webhook). */
export function earlyRenewalBonusAvailable(expiresAt: string | null | undefined): boolean {
  return !!expiresAt && londonDaysUntil(expiresAt) >= 0;
}

/** True when this profile is currently listed on the register (visible in browse / saved). */
export function isProfileListedOnRegister(p: {
  status: string;
  hidden_reason?: string | null;
  membership_expires_at: string | null;
}): boolean {
  if (p.status !== 'active') return false;
  if (p.hidden_reason != null) return false;
  return hasMembershipAccess(p.membership_expires_at);
}

/** True when the member should be sent to the membership-expired / renewal flow (not the browse UI). */
export function profileNeedsMembershipExpiredRoute(p: {
  status: string;
  membership_expires_at: string | null;
}): boolean {
  if (p.status === 'expired' || p.status === 'closed') return true;
  if (!p.membership_expires_at) return false;
  if (hasMembershipAccess(p.membership_expires_at)) return false;
  return p.status === 'active';
}
