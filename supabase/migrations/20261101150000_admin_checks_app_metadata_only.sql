-- Security: database admin checks trusted user_metadata, which users can edit.
--
-- Found on prod 1 Nov 2026: is_admin() had drifted from 20260415130000 and again
-- returned true when user_metadata.is_admin was set, and the storage policies
-- id_documents_admin_select and profile_photos_admin_select checked only
-- user_metadata. Any signed-in member could call auth.updateUser with
-- data.is_admin = true and, after a token refresh, read every member_private row,
-- update any profile, and download every ID document and photo. No account had
-- done so (checked the same day).
--
-- is_admin() now reads app_metadata only, and excludes support admins. Support
-- admins are limited to read-only actions in the edge functions; through RLS they
-- could PATCH profiles and member_private directly. The admin UI never queries
-- tables or storage directly (all admin data goes through edge functions with the
-- service role), so this narrows nothing the UI uses.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', '')) IN ('true', 't', '1', 'yes')
     AND coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') <> 'support';
$$;

-- Admin photo and ID document access is always signed server-side, so these
-- browser-side read policies are not needed at all.
DROP POLICY IF EXISTS id_documents_admin_select ON storage.objects;
DROP POLICY IF EXISTS profile_photos_admin_select ON storage.objects;
