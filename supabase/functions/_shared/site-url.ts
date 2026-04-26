/**
 * Canonical public site base (no trailing slash).
 * Override in production with Edge secret PUBLIC_SITE_URL (must match Supabase Auth Site URL).
 *
 * Keep string values in sync with [src/lib/siteUrl.ts](../../../src/lib/siteUrl.ts) (Vite app).
 */
export const CANONICAL_PUBLIC_SITE_URL = 'https://vanikmatrimonial.co.uk';

/** Legacy Vercel host; still allowed in CORS defaults for existing deployments. */
export const LEGACY_VERCEL_DEPLOYMENT_URL = 'https://vanik-matrimonial.vercel.app';

export function publicSiteBaseUrl(): string {
  const raw = Deno.env.get('PUBLIC_SITE_URL')?.trim().replace(/\/+$/, '');
  return raw || CANONICAL_PUBLIC_SITE_URL;
}
