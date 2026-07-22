import { getAccessToken, postFunctionOptionalAuth } from './supabase';

/**
 * Member-facing errors show a short reference code only; the technical detail goes to
 * `client_error_log` (admin-only, viewable at /admin/error-log). Never put config, table, or
 * environment names in text a member can read.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 - these get misread over the phone

/** Short reference the member can quote to support, e.g. VMR-K3F7QP. */
export function newErrorCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `VMR-${out}`;
}

export type ErrorLogDetail = Record<string, unknown>;

/**
 * Sends diagnostics for `code` to the server. Never throws and never blocks the UI - if logging
 * itself fails the member still has a code, and the browser console still has the detail.
 */
export function reportError(
  code: string,
  area: string,
  detail: ErrorLogDetail = {},
  message?: string,
): void {
  console.error(`[${code}] ${area}`, message ?? '', detail);
  void (async () => {
    try {
      const token = await getAccessToken().catch(() => null);
      await postFunctionOptionalAuth(
        'log-client-error',
        {
          error_code: code,
          area,
          message: message ?? null,
          detail,
          page_url: window.location.pathname + window.location.search,
        },
        token,
      );
    } catch {
      /* diagnostics are best-effort; the member already has their reference code */
    }
  })();
}
