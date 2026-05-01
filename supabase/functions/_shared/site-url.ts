/**
 * Canonical public site base (no trailing slash).
 * Override in production with Edge secret PUBLIC_SITE_URL (must match Supabase Auth Site URL).
 *
 * Keep string values in sync with [src/lib/siteUrl.ts](../../../src/lib/siteUrl.ts) (Vite app).
 */
export const CANONICAL_PUBLIC_SITE_URL = 'https://matrimonial.vanikcouncil.uk';

/** Secondary fallback origin kept aligned to the canonical domain. */
export const LEGACY_VERCEL_DEPLOYMENT_URL = 'https://matrimonial.vanikcouncil.uk';

/**
 * Browser Origins allowed to call Edge Functions (CORS). List every hostname users may use
 * (apex vs www are different Origins).
 */
export const EDGE_CORS_SITE_ORIGINS = [
  'https://matrimonial.vanikcouncil.uk',
  'https://www.matrimonial.vanikcouncil.uk',
] as const;

export function publicSiteBaseUrl(): string {
  const raw = Deno.env.get('PUBLIC_SITE_URL')?.trim().replace(/\/+$/, '');
  return raw || CANONICAL_PUBLIC_SITE_URL;
}
