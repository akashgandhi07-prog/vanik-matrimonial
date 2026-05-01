-- IP / composite keys for Edge Function rate limits (demo browse, coupon checks, etc.).
-- Accessed with service role only from Edge Functions.

CREATE TABLE IF NOT EXISTS public.function_rate_limits (
  scope text NOT NULL,
  rate_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, rate_key)
);

ALTER TABLE public.function_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY function_rate_limits_deny_all ON public.function_rate_limits
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.function_rate_limits TO service_role;
