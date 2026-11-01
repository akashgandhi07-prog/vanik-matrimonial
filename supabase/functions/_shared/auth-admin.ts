/** JWT app_metadata.is_admin only - never trust user_metadata (clients can edit it). */

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

/**
 * Authenticator assurance level ('aal1' | 'aal2') of the caller's session, read
 * from the bearer JWT. Only call after auth.getUser() has accepted this token:
 * that check validates it, so its claims can be trusted here.
 */
export function sessionAal(authHeader: string | null): string | null {
  const token = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const aal = (JSON.parse(json) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/**
 * Admins must have completed their TOTP step this session (aal2); a password
 * alone is not enough. ADMIN_MFA_REQUIRED=false switches this off temporarily,
 * e.g. while the admin UI that prompts for the code is still being deployed.
 */
export function adminMfaSatisfied(authHeader: string | null): boolean {
  if (Deno.env.get('ADMIN_MFA_REQUIRED')?.trim().toLowerCase() === 'false') return true;
  return sessionAal(authHeader) === 'aal2';
}
