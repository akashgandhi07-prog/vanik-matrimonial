/** True when the member should be sent to the membership-expired / renewal flow (not the browse UI). */
export function profileNeedsMembershipExpiredRoute(p: {
  status: string;
  membership_expires_at: string | null;
}): boolean {
  if (p.status === 'expired' || p.status === 'archived') return true;
  if (!p.membership_expires_at) return false;
  if (new Date(p.membership_expires_at) > new Date()) return false;
  return p.status === 'active' || p.status === 'matched';
}
