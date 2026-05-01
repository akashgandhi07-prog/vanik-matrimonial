import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type RateLimitOpts = {
  scope: string;
  rateKey: string;
  maxAttempts: number;
  windowMs: number;
};

/**
 * Sliding-window style counter: increment within window or reset window. Returns false if over max.
 */
export async function allowFunctionRateLimit(
  admin: SupabaseClient,
  opts: RateLimitOpts,
  depth = 0
): Promise<boolean> {
  const { scope, rateKey, maxAttempts, windowMs } = opts;
  const now = new Date();

  if (depth > 3) {
    return false;
  }

  const { data: row } = await admin
    .from('function_rate_limits')
    .select('attempt_count, window_started_at')
    .eq('scope', scope)
    .eq('rate_key', rateKey)
    .maybeSingle();

  if (!row) {
    const { error: insErr } = await admin.from('function_rate_limits').insert({
      scope,
      rate_key: rateKey,
      attempt_count: 1,
      window_started_at: now.toISOString(),
    });
    if (insErr?.code === '23505') {
      return allowFunctionRateLimit(admin, opts, depth + 1);
    }
    if (insErr) {
      console.error('function_rate_limits insert', insErr.message);
      return true;
    }
    return true;
  }

  const start = new Date(row.window_started_at as string);
  if (now.getTime() - start.getTime() > windowMs) {
    await admin
      .from('function_rate_limits')
      .update({ attempt_count: 1, window_started_at: now.toISOString() })
      .eq('scope', scope)
      .eq('rate_key', rateKey);
    return true;
  }

  const count = row.attempt_count as number;
  if (count >= maxAttempts) {
    return false;
  }

  await admin
    .from('function_rate_limits')
    .update({ attempt_count: count + 1 })
    .eq('scope', scope)
    .eq('rate_key', rateKey);
  return true;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] ?? req.headers.get('cf-connecting-ip') ?? 'unknown').trim();
}
