-- Member-controlled pause: hidden from browse / discovery but still visible to people
-- who already requested them (member_request_profiles + serve-photo unchanged).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS browse_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.browse_paused IS
  'When true, profile is excluded from browse_opposite_profiles and opposite-gender RLS; existing contact requests still work.';

DROP POLICY IF EXISTS profiles_select_opposite_active ON public.profiles;

CREATE POLICY profiles_select_opposite_active ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      status = 'active'
      AND show_on_register = true
      AND membership_expires_at > now()
      AND public.viewer_can_browse_gender(public.current_profile_id(), gender)
      AND (
        browse_paused = false
        OR EXISTS (
          SELECT 1
          FROM public.requests r
          WHERE r.requester_id = public.current_profile_id()
            AND profiles.id = ANY (r.candidate_ids)
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.browse_opposite_profiles()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id <> public.current_profile_id()
    AND public.viewer_can_browse_gender(public.current_profile_id(), p.gender)
    AND p.status = 'active'
    AND p.show_on_register = true
    AND p.browse_paused = false
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;
