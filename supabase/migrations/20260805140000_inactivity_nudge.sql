-- Tracks the last "you have not signed in for a while" nudge so the job never
-- emails the same member twice in quick succession.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS inactivity_nudge_sent_at timestamptz;

COMMENT ON COLUMN public.profiles.inactivity_nudge_sent_at IS
  'When the last inactivity nudge email was sent; used by send-inactivity-nudges to rate limit.';
