-- Simple IP-based rate limit store for submit-registration Edge Function (max 3/hour per IP)
CREATE TABLE IF NOT EXISTS public.registration_rate_limits (
  ip text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registration_rate_limits ENABLE ROW LEVEL SECURITY;

-- No client access - Edge Function uses service role only
CREATE POLICY registration_rate_deny_all ON public.registration_rate_limits
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.registration_rate_limits TO service_role;
