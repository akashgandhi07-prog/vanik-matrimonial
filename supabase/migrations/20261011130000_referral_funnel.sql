-- Referral funnel events: one row each time a referrer's invite is opened by a
-- visitor ('open') or shared by the referrer ('share'). Sign-ups are read from
-- member_private.referred_by_code and acceptances from public.referrals, so only
-- the two anonymous-or-member-side steps need storing here.
-- No IP, user agent or visitor identifier is stored: counts only.

CREATE TABLE IF NOT EXISTS public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('open', 'share')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.referral_events IS
  'Counts of invite-link opens and WhatsApp/copy shares per referrer. Written only by the record-referral-event edge function; read by admin analytics.';

CREATE INDEX IF NOT EXISTS referral_events_referrer_idx ON public.referral_events (referrer_profile_id, event);

ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

-- Written and read only through edge functions (service role). Admins may also
-- read directly; members never see funnel rows.
DROP POLICY IF EXISTS "admin_read" ON public.referral_events;
CREATE POLICY "admin_read" ON public.referral_events FOR SELECT USING (is_admin());

GRANT SELECT ON TABLE public.referral_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_events TO service_role;
