/** Shared secret guard for cron / scheduled invocations.
 *
 * CRON_SECRET must be set in Edge Function secrets. If it is not configured the
 * endpoint is left open — this logs a warning and allows through in development,
 * but in production you should always set CRON_SECRET so that only your scheduler
 * can trigger these endpoints.
 */
export function cronUnauthorized(req: Request): Response | null {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) {
    // Allow through but warn — operator should set CRON_SECRET in production.
    console.warn('CRON_SECRET is not set; cron endpoint is unauthenticated. Set CRON_SECRET in Edge Function secrets.');
    return null;
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
