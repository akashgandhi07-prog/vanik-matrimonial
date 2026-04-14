const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'] as const;

/** Production web app(s) calling Edge Functions from the browser (must match Vercel deployment). */
const DEFAULT_PUBLIC_SITE_ORIGINS = ['https://vanik-matrimonial.vercel.app'] as const;

const ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature, stripe-signature, x-cron-secret';

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '');
}

function collectAllowedOrigins(): Set<string> {
  const out = new Set<string>();
  for (const o of DEFAULT_DEV_ORIGINS) out.add(o);
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
  // Allow any Vercel preview/production host over HTTPS unless explicitly disabled (set CORS_ALLOW_VERCEL=0).
  if (Deno.env.get('CORS_ALLOW_VERCEL') !== '0') {
    try {
      const u = new URL(origin);
      if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) return true;
    } catch {
      /* ignore */
    }
  }
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
    base['Access-Control-Allow-Origin'] = '*';
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
