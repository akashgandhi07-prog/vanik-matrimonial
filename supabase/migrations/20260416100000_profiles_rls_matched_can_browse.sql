-- Members with status `matched` were blocked from seeing opposite-gender profiles because
-- profiles_select_opposite_active only allowed viewer.status = 'active'. Align RLS with the app,
-- which treats matched + valid membership like active for dashboard access.

DROP POLICY IF EXISTS profiles_select_opposite_active ON public.profiles;

CREATE POLICY profiles_select_opposite_active ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      status = 'active'
      AND show_on_register = true
      AND membership_expires_at > now()
      AND EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.auth_user_id = auth.uid()
          AND viewer.status IN ('active', 'matched')
          AND viewer.membership_expires_at > now()
          AND viewer.gender IS DISTINCT FROM profiles.gender
      )
    )
  );
