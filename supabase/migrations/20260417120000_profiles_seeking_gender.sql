-- Explicit browse preference: which genders this member may see (RLS + browse RPC).
-- Replaces implicit "opposite of profiles.gender" for clearer support and product rules.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seeking_gender text;

UPDATE public.profiles
SET seeking_gender = CASE gender
  WHEN 'Male' THEN 'Female'
  WHEN 'Female' THEN 'Male'
END
WHERE seeking_gender IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN seeking_gender SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_seek_gender_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_seek_gender_chk CHECK (seeking_gender IN ('Male', 'Female', 'Both'));

COMMENT ON COLUMN public.profiles.seeking_gender IS
  'Browse/contact: listable profiles must have gender matching this value, or any gender if Both.';

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
          AND (
            viewer.seeking_gender = 'Both'
            OR viewer.seeking_gender = profiles.gender
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
  INNER JOIN public.profiles v ON v.auth_user_id = auth.uid()
  WHERE p.id <> v.id
    AND (
      v.seeking_gender = 'Both'
      OR v.seeking_gender = p.gender
    )
    AND p.status = 'active'
    AND p.show_on_register = true
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now()
    AND v.status IN ('active', 'matched')
    AND (
      v.membership_expires_at IS NULL
      OR v.membership_expires_at > now()
    );
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;

COMMENT ON FUNCTION public.browse_opposite_profiles() IS
  'Member browse: listable profiles matching viewer.seeking_gender; server now(); aligns with profiles_select_opposite_active.';
