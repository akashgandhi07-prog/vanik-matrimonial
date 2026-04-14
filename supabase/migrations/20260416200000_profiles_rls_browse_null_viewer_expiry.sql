-- Browsing uses EXISTS(viewer.membership_expires_at > now()). If the viewer row has NULL
-- membership_expires_at (legacy data or partial approval), that predicate is unknown and no
-- opposite-gender rows pass RLS — browse shows empty while the app still allows the dashboard.
-- Align with MemberAuthGate: null expiry does not force the membership-expired route.

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
          AND (
            viewer.membership_expires_at IS NULL
            OR viewer.membership_expires_at > now()
          )
          AND viewer.gender IS DISTINCT FROM profiles.gender
      )
    )
  );
