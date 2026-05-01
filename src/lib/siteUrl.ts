/**
 * Canonical public site (no trailing slash). Vite env VITE_PUBLIC_SITE_URL overrides in all environments.
 *
 * Keep string values in sync with [supabase/functions/_shared/site-url.ts](../../supabase/functions/_shared/site-url.ts).
 */
export const CANONICAL_PUBLIC_SITE_URL = 'https://matrimonial.vanikcouncil.uk';

export const LEGACY_VERCEL_DEPLOYMENT_URL = 'https://matrimonial.vanikcouncil.uk';

/** Hostnames that should behave like the canonical site (analytics, links). */
export const SITE_HOST_ALIASES = ['matrimonial.vanikcouncil.uk', 'www.matrimonial.vanikcouncil.uk'] as const;
