/** JWT app_metadata.is_admin only — never trust user_metadata (clients can edit it). */

export function metaIsAdminFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 't' || s === 'yes';
  }
  return false;
}

export function isUserAdmin(user: { app_metadata?: unknown }): boolean {
  const a = user.app_metadata as Record<string, unknown> | undefined;
  return metaIsAdminFlag(a?.is_admin);
}

/** `support` = read-mostly admin; anything else (including missing) = full power when is_admin. */
export type AdminPowerRole = 'super' | 'support';

export function adminPowerRole(user: { app_metadata?: unknown }): AdminPowerRole {
  const a = user.app_metadata as Record<string, unknown> | undefined;
  if (a?.admin_role === 'support') return 'support';
  return 'super';
}

export function isSupportAdmin(user: { app_metadata?: unknown }): boolean {
  return adminPowerRole(user) === 'support';
}
