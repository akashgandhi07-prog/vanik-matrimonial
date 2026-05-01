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

function normalizeHttpOrigin(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.pathname !== '/' || u.search || u.hash) {
      return null;
    }
    return u.origin;
  } catch {
    try {
      const u = new URL(`https://${input.trim()}`);
      if (u.username || u.password) return null;
      if (u.pathname !== '/' || u.search || u.hash) return null;
      return u.origin;
    } catch {
      return null;
    }
  }
}

function isLocalHttpDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function envFlagEnabled(name: string, defaultTrue = true): boolean {
  const raw = (Deno.env.get(name) ?? '').trim().toLowerCase();
  if (!raw) return defaultTrue;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function isVercelPreviewOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

/**
 * Stripe success/cancel URLs must return users to the same host they started from (preview, www, etc.)
 * without open redirects. Only canonical CORS origins, PUBLIC_SITE_URL, optional
 * STRIPE_CHECKOUT_ALLOWED_ORIGINS (comma-separated), and local http dev hosts are allowed.
 */
export function checkoutRedirectBase(clientOrigin: unknown): string {
  const fallback = publicSiteBaseUrl();
  const allow = new Set<string>();
  for (const o of EDGE_CORS_SITE_ORIGINS) {
    const n = normalizeHttpOrigin(o);
    if (n) allow.add(n.toLowerCase());
  }
  const pub = normalizeHttpOrigin(fallback);
  if (pub) allow.add(pub.toLowerCase());

  const extra = Deno.env.get('STRIPE_CHECKOUT_ALLOWED_ORIGINS')?.trim() ?? '';
  for (const part of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
    const n = normalizeHttpOrigin(part);
    if (n) allow.add(n.toLowerCase());
  }

  if (typeof clientOrigin !== 'string' || !clientOrigin.trim()) {
    return fallback;
  }
  const candidate = normalizeHttpOrigin(clientOrigin.trim());
  if (!candidate) return fallback;
  const lower = candidate.toLowerCase();
  if (allow.has(lower) || isLocalHttpDevOrigin(candidate)) {
    return candidate.replace(/\/$/, '');
  }
  if (envFlagEnabled('CORS_ALLOW_VERCEL', true) && isVercelPreviewOrigin(candidate)) {
    return candidate.replace(/\/$/, '');
  }
  return fallback;
}
