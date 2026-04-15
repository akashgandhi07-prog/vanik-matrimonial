-- Fix browse returning zero rows for valid members.
-- Use explicit viewer profile id instead of auth.uid() inside SECURITY DEFINER helper.
-- This avoids contexts where auth.uid() is unavailable and browse policy evaluates false.

DROP FUNCTION IF EXISTS public.viewer_can_browse_gender(text);

CREATE OR REPLACE FUNCTION public.viewer_can_browse_gender(
  viewer_profile_id uuid,
  target_gender text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles viewer
    WHERE viewer.id = viewer_profile_id
      AND viewer.status IN ('active', 'matched')
      AND viewer.membership_expires_at IS NOT NULL
      AND viewer.membership_expires_at > now()
      AND (
        viewer.seeking_gender = 'Both'
        OR viewer.seeking_gender = target_gender
      )
  );
$$;

COMMENT ON FUNCTION public.viewer_can_browse_gender(uuid, text) IS
  'Returns true when the given viewer profile is eligible to browse a given gender.';

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
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;
