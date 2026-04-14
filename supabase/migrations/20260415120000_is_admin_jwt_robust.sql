-- Align DB is_admin() with app: JWT may expose is_admin as boolean, string ("true"), or number (1).
-- Previously (text)::boolean failed or was false for non-canonical forms, so RLS hid all rows from admins.

CREATE OR REPLACE FUNCTION public.jwt_bool_claim(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN j IS NULL OR j = 'null'::jsonb THEN false
    WHEN jsonb_typeof(j) = 'boolean' THEN j = 'true'::jsonb
    WHEN jsonb_typeof(j) = 'string' THEN lower(trim(j #>> '{}')) IN ('true', 't', '1', 'yes')
    WHEN jsonb_typeof(j) = 'number' THEN (j #>> '{}')::numeric = 1
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.jwt_bool_claim((auth.jwt()::jsonb) -> 'user_metadata' -> 'is_admin')
 OR public.jwt_bool_claim((auth.jwt()::jsonb) -> 'app_metadata' -> 'is_admin');
$$;

-- Storage policies: use same helper (and allow app_metadata admins).
DROP POLICY IF EXISTS id_documents_admin_select ON storage.objects;
CREATE POLICY id_documents_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'id-documents'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS profile_photos_admin_select ON storage.objects;
CREATE POLICY profile_photos_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND public.is_admin()
  );
