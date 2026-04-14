/** Shared secret guard for cron / scheduled invocations. */
export function cronUnauthorized(req: Request): Response | null {
  const secret = Deno.env.get('CRON_SECRET')?.trim();
  if (!secret) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        message: 'Set CRON_SECRET in Edge Function secrets and send header x-cron-secret.',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
