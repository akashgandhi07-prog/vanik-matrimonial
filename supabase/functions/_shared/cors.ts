import { CANONICAL_PUBLIC_SITE_URL, LEGACY_VERCEL_DEPLOYMENT_URL } from './site-url.ts';

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'] as const;

/** Production origins allowed if PUBLIC_SITE_URL is unset (custom domain + legacy Vercel). */
const DEFAULT_PUBLIC_SITE_ORIGINS = [LEGACY_VERCEL_DEPLOYMENT_URL, CANONICAL_PUBLIC_SITE_URL] as const;

const ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature, stripe-signature, x-cron-secret';

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '');
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = (Deno.env.get(name) ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function isVercelOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

function isProductionEnv(): boolean {
  const denoEnv = (Deno.env.get('DENO_ENV') ?? '').toLowerCase().trim();
  const nodeEnv = (Deno.env.get('NODE_ENV') ?? '').toLowerCase().trim();
  const appEnv = (Deno.env.get('APP_ENV') ?? '').toLowerCase().trim();
  return denoEnv === 'production' || nodeEnv === 'production' || appEnv === 'production';
}

function collectAllowedOrigins(): Set<string> {
  const out = new Set<string>();
  if (!isProductionEnv()) {
    for (const o of DEFAULT_DEV_ORIGINS) out.add(o);
  }
  for (const o of DEFAULT_PUBLIC_SITE_ORIGINS) out.add(o);
  const site = Deno.env.get('PUBLIC_SITE_URL');
  if (site) out.add(normalizeOrigin(site));
  const extra = Deno.env.get('CORS_ALLOWED_ORIGINS');
  if (extra) {
    for (const p of extra.split(',')) {
      const s = normalizeOrigin(p);
      if (s) out.add(s);
    }
  }
  return out;
}

function originAllowed(origin: string, allowed: Set<string>): boolean {
  if (allowed.has(origin)) return true;
  // Allow Vercel preview/production subdomains unless explicitly disabled.
  if (envFlag('CORS_ALLOW_VERCEL', true) && isVercelOrigin(origin)) return true;
  return false;
}

/**
 * Browser CORS: reflect allowed Origin; non-browser / server callers (no Origin) get *.
 * Unknown browser origins get no Access-Control-Allow-Origin (preflight fails).
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = collectAllowedOrigins();
  const origin = req.headers.get('Origin');
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (!origin) {
    if (!isProductionEnv()) {
      base['Access-Control-Allow-Origin'] = '*';
    }
    return base;
  }
  if (originAllowed(origin, allowed)) {
    base['Access-Control-Allow-Origin'] = origin;
    return base;
  }
  return base;
}

export function jsonResponse(body: unknown, req: Request, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  });
}
