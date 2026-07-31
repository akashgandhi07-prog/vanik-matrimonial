/** True when this profile is currently listed on the register (visible in browse / saved). */
export function isProfileListedOnRegister(p: {
  status: string;
  hidden_reason?: string | null;
  membership_expires_at: string | null;
}): boolean {
  if (p.status !== 'active') return false;
  if (p.hidden_reason != null) return false;
  if (!p.membership_expires_at || new Date(p.membership_expires_at) <= new Date()) return false;
  return true;
}

/** True when the member should be sent to the membership-expired / renewal flow (not the browse UI). */
export function profileNeedsMembershipExpiredRoute(p: {
  status: string;
  membership_expires_at: string | null;
}): boolean {
  if (p.status === 'expired' || p.status === 'closed') return true;
  if (!p.membership_expires_at) return false;
  if (new Date(p.membership_expires_at) > new Date()) return false;
  return p.status === 'active';
}
