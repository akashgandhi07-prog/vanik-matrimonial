-- Admin authorization: app_metadata.is_admin only (user_metadata is client-editable in Supabase Auth).
-- If someone was promoted only via the old promote action (user_metadata), promote them again in Admin → Settings after this migration.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.jwt_bool_claim((auth.jwt()::jsonb) -> 'app_metadata' -> 'is_admin');
$$;

-- Remove hard-coded emails from repo; grant admin via Dashboard or admin-manage-users promote.
CREATE OR REPLACE FUNCTION public.auto_promote_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;
