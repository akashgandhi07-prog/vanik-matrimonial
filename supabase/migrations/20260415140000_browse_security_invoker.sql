-- browse_opposite_profiles was SECURITY DEFINER which caused auth.uid() to return NULL
-- (the JWT GUC is not visible in the superuser security context).
-- Switching to SECURITY INVOKER so the function runs as the authenticated caller;
-- auth.uid() works correctly and RLS on profiles handles row filtering.

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
    AND p.gender IS DISTINCT FROM v.gender
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
