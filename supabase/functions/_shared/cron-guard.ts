/** Optional shared secret for cron / scheduled invocations (set CRON_SECRET in function env). */
export function cronUnauthorized(req: Request): Response | null {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return null;
  if (req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
