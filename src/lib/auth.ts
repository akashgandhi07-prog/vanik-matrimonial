import type { User } from '@supabase/supabase-js';
import { CANONICAL_PUBLIC_SITE_URL } from './siteUrl';

/**
 * Build absolute URLs for auth emails. We intentionally prefer a stable public URL
 * so links do not depend on the current browser origin (e.g. localhost during dev).
 */
export function publicAuthUrl(path: string): string {
  const raw = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim();
  const base = (raw || CANONICAL_PUBLIC_SITE_URL).replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/** Shape returned by most `supabase.auth.*` calls; `code` is present on many Auth errors. */
export type AuthLikeError = {
  message: string;
  status?: number;
  code?: string;
} | null | undefined;

export type AuthErrorContext = 'sign_in' | 'reauth_current_password';

/**
 * Turns Supabase Auth errors into clear copy. Note: sign-in uses one message for both
 * "no such user" and "wrong password" (enumeration protection) - we explain both possibilities.
 */
export function userFacingAuthError(
  error: AuthLikeError,
  context: AuthErrorContext = 'sign_in'
): string {
  if (!error?.message?.trim()) {
    return 'Something went wrong. Please try again.';
  }
  const raw = error.message.trim();
  const lower = raw.toLowerCase();
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';

  if (
    code === 'invalid_credentials' ||
    lower.includes('invalid login credentials') ||
    lower.includes('invalid credentials')
  ) {
    if (context === 'reauth_current_password') {
      return (
        'The current password is not correct. Try again, or sign out and use Forgot password if you need to reset it.'
      );
    }
    return (
      'Sign-in did not work. If this email is not registered yet, create an account first. ' +
      'If you already have an account, check your password or use Forgot password.'
    );
  }

  if (
    code === 'email_not_confirmed' ||
    lower.includes('email not confirmed') ||
    lower.includes('not confirmed')
  ) {
    return (
      'Please verify your email before signing in. Check your inbox for the link, or use the option to resend from the registration page.'
    );
  }

  if (code === 'user_banned' || lower.includes('user is banned') || lower.includes('banned')) {
    return 'This account cannot sign in. Contact support if you think this is a mistake.';
  }

  if (
    code === 'over_request_rate_limit' ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('email rate limit')
  ) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  if (
    lower.includes('refresh token') ||
    (lower.includes('jwt') && (lower.includes('invalid') || lower.includes('expired')))
  ) {
    return 'Your session has expired or is invalid. Please sign in again.';
  }

  if (
    lower.includes('already registered') ||
    lower.includes('user already registered') ||
    lower.includes('user already exists') ||
    lower.includes('already been registered')
  ) {
    return 'An account with this email already exists. Try signing in or use Forgot password.';
  }

  if (code === 'signup_disabled' || lower.includes('signups not allowed')) {
    return 'New registrations are temporarily unavailable. Please try again later or contact support.';
  }

  if (
    lower.includes('error sending confirmation email') ||
    lower.includes('error sending email') ||
    lower.includes('smtp')
  ) {
    return (
      'Account creation could not send a verification email. Please try again shortly. ' +
      'If it keeps failing, support needs to check Supabase Auth email/SMTP settings.'
    );
  }

  if (lower.includes('password') && lower.includes('should contain')) {
    return raw;
  }

  return raw;
}

function metaIsAdmin(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
  return false;
}

/** Admin flag is stored in app_metadata only (not user_metadata - clients can edit that). */
export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const am = user.app_metadata as { is_admin?: unknown } | undefined;
  return metaIsAdmin(am?.is_admin);
}

/** `support` = read-mostly admin; full power when `is_admin` and role is absent or `super`. */
export type AdminPowerRole = 'super' | 'support';

export function adminPowerRole(user: User | null | undefined): AdminPowerRole {
  if (!user) return 'super';
  const am = user.app_metadata as { admin_role?: unknown } | undefined;
  if (am?.admin_role === 'support') return 'support';
  return 'super';
}

export function isSupportAdmin(user: User | null | undefined): boolean {
  return adminPowerRole(user) === 'support';
}

export function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
  return age;
}
