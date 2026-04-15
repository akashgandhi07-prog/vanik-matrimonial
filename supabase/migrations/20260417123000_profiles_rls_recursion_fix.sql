-- Fix infinite recursion in profiles_select_opposite_active.
-- RLS policy previously queried public.profiles again (viewer subquery), which can
-- recurse when evaluating SELECT access on public.profiles rows.

CREATE OR REPLACE FUNCTION public.viewer_can_browse_gender(target_gender text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles viewer
    WHERE viewer.auth_user_id = auth.uid()
      AND viewer.status IN ('active', 'matched')
      AND (
        viewer.membership_expires_at IS NULL
        OR viewer.membership_expires_at > now()
      )
      AND (
        viewer.seeking_gender = 'Both'
        OR viewer.seeking_gender = target_gender
      )
  );
$$;

COMMENT ON FUNCTION public.viewer_can_browse_gender(text) IS
  'Returns true when the current authenticated member is eligible to browse a given gender.';

DROP POLICY IF EXISTS profiles_select_opposite_active ON public.profiles;

CREATE POLICY profiles_select_opposite_active ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      status = 'active'
      AND show_on_register = true
      AND membership_expires_at > now()
      AND public.viewer_can_browse_gender(gender)
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
    AND public.viewer_can_browse_gender(p.gender)
    AND p.status = 'active'
    AND p.show_on_register = true
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;
