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

  if (depth === 0) {
    const { data: rpcAllowed, error: rpcErr } = await admin.rpc('check_function_rate_limit', {
      p_scope: scope,
      p_rate_key: rateKey,
      p_max: maxAttempts,
      p_window_ms: windowMs,
    });
    if (!rpcErr && typeof rpcAllowed === 'boolean') {
      return rpcAllowed;
    }
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
      return false;
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
  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return 'unknown';
}
