-- 1. Grace period after a membership ends.
--
-- Members keep full access (listed in browse, can browse and make requests) for 14 days
-- after membership_expires_at, so a late renewal never drops them off the register.
-- expire-memberships only sets status = 'expired' once the grace period is over.
--
-- Keep the 14 days in step with MEMBERSHIP_GRACE_DAYS in
-- supabase/functions/_shared/membership.ts and src/lib/memberStatus.ts.

CREATE OR REPLACE FUNCTION public.membership_is_current(p_expires_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_expires_at IS NOT NULL AND p_expires_at > now() - interval '14 days';
$$;

COMMENT ON FUNCTION public.membership_is_current(timestamptz) IS
  'True while a membership is current or within its 14-day grace period after membership_expires_at.';

GRANT EXECUTE ON FUNCTION public.membership_is_current(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.viewer_can_browse_gender(viewer_profile_id uuid, target_gender text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles viewer
    WHERE viewer.id = viewer_profile_id
      AND viewer.status = 'active'
      AND public.membership_is_current(viewer.membership_expires_at)
      AND (
        viewer.seeking_gender = 'Both'
        OR viewer.seeking_gender = target_gender
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.browse_opposite_profiles()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id <> public.current_profile_id()
    AND public.viewer_can_browse_gender(public.current_profile_id(), p.gender)
    AND p.status = 'active'
    AND p.hidden_reason IS NULL
    AND public.membership_is_current(p.membership_expires_at);
$$;

ALTER POLICY profiles_select_opposite_active ON public.profiles
  USING (
    is_admin()
    OR (
      status = 'active'
      AND public.membership_is_current(membership_expires_at)
      AND viewer_can_browse_gender(current_profile_id(), gender)
      AND (
        hidden_reason IS NULL
        OR (
          hidden_reason = 'member_paused'
          AND EXISTS (
            SELECT 1
            FROM public.requests r
            WHERE r.requester_id = current_profile_id()
              AND profiles.id = ANY (r.candidate_ids)
          )
        )
      )
    )
  );

-- 2. Renewal funnel events, so admins can tell "never opened the renewal page" apart from
-- "opened it but did not start checkout" and "started checkout but did not pay". Paid
-- renewals are already in stripe_checkout_sessions (purpose = 'renewal'), which only
-- records completed payments.

CREATE TABLE IF NOT EXISTS public.renewal_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('page_view', 'checkout_started')),
  source text CHECK (source IN ('email', 'banner', 'expired', 'direct')),
  profile_status text,
  days_to_expiry integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.renewal_funnel_events IS
  'Renewal page views (log_renewal_page_visit) and renewal checkout starts (create-checkout-session). Admins only.';
COMMENT ON COLUMN public.renewal_funnel_events.source IS
  'Page views only. email = reminder/expiry email link, banner = member-area banner, expired = redirected after access ended, direct = anything else.';
COMMENT ON COLUMN public.renewal_funnel_events.days_to_expiry IS
  'UK calendar days from the event to membership_expires_at (negative once it has passed).';

CREATE INDEX IF NOT EXISTS renewal_funnel_events_profile_idx ON public.renewal_funnel_events (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS renewal_funnel_events_created_idx ON public.renewal_funnel_events (created_at DESC);

ALTER TABLE public.renewal_funnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read" ON public.renewal_funnel_events;
CREATE POLICY "admin_read" ON public.renewal_funnel_events FOR SELECT USING (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.renewal_funnel_events TO service_role;
GRANT SELECT ON public.renewal_funnel_events TO authenticated;

CREATE OR REPLACE FUNCTION public.log_renewal_page_visit(p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_source text := CASE WHEN p_source IN ('email', 'banner', 'expired') THEN p_source ELSE 'direct' END;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = public.current_profile_id();
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.renewal_funnel_events (profile_id, event, source, profile_status, days_to_expiry)
  VALUES (
    v_profile.id,
    'page_view',
    v_source,
    v_profile.status,
    (v_profile.membership_expires_at AT TIME ZONE 'Europe/London')::date
      - (now() AT TIME ZONE 'Europe/London')::date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_renewal_page_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_renewal_page_visit(text) TO authenticated;
