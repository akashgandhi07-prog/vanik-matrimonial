/** Constant-time string comparison so secret checks do not leak timing info. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

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
  const provided = req.headers.get('x-cron-secret') ?? '';
  if (!provided || !timingSafeEqualStrings(provided, secret)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
