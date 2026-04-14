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
