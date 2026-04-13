-- Allow admins to read ID documents and profile photos for review (JWT user_metadata.is_admin)
CREATE POLICY id_documents_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'id-documents'
    AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );

CREATE POLICY profile_photos_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
  );
