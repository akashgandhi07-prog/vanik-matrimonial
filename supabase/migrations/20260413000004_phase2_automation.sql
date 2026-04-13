-- Phase 2: feedback magic tokens, reminder tracking, email delivery metadata

CREATE TABLE public.feedback_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, candidate_id)
);

CREATE INDEX feedback_tokens_token_idx ON public.feedback_tokens (token);

ALTER TABLE public.feedback_tokens ENABLE ROW LEVEL SECURITY;

-- Called from Edge Functions (service role) to rotate magic links when sending reminders.
CREATE OR REPLACE FUNCTION public.refresh_feedback_token(
  p_request_id uuid,
  p_candidate_id uuid,
  p_requester_id uuid,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid;
BEGIN
  INSERT INTO public.feedback_tokens (request_id, candidate_id, requester_id, expires_at, token)
  VALUES (p_request_id, p_candidate_id, p_requester_id, p_expires_at, gen_random_uuid())
  ON CONFLICT (request_id, candidate_id) DO UPDATE SET
    token = gen_random_uuid(),
    expires_at = EXCLUDED.expires_at,
    used_at = NULL
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_feedback_token(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_feedback_token(uuid, uuid, uuid, timestamptz) TO service_role;

-- No policies: only service_role bypasses RLS for token issuance and validation in Edge Functions.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS feedback_reminder_21_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_reminder_35_sent_at timestamptz;

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_detail text;

COMMENT ON TABLE public.feedback_tokens IS 'Magic links for anonymous feedback; managed by Edge Functions.';

-- pg_cron: configure in Supabase Dashboard (Database > Cron) or vault + cron.schedule:
-- https://supabase.com/docs/guides/functions/schedule-functions
-- Suggested UTC (Authorization: Bearer anon key; verify_jwt=false on each function):
--   expire-memberships — 0 0 * * *
--   send-feedback-reminders, send-renewal-reminders, send-admin-digest — 0 9 * * *
--   cleanup-unverified-accounts — 0 2 * * *
--   archive-lapsed-members — 0 9 * * 1
