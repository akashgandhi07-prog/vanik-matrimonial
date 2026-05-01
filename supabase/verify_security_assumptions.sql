-- Run in Supabase SQL Editor after deploying migrations. Expect no rows if checks pass.
-- Confirms is_admin() does not trust client-editable user_metadata for privilege escalation.

WITH def AS (
  SELECT pg_get_functiondef(p.oid) AS src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_admin' AND pg_function_is_visible(p.oid)
)
SELECT 'FAIL: is_admin definition must use app_metadata only; found user_metadata reference' AS check_name
FROM def
WHERE src ILIKE '%user_metadata%'

UNION ALL

SELECT 'FAIL: id_documents_admin_select policy still references user_metadata'
WHERE EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'id_documents_admin_select'
    AND qual::text ILIKE '%user_metadata%'
)

UNION ALL

SELECT 'FAIL: profile_photos_admin_select policy still references user_metadata'
WHERE EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'profile_photos_admin_select'
    AND qual::text ILIKE '%user_metadata%'
);

-- If this returns 0 rows, policies match the intended app_metadata-only admin model.
