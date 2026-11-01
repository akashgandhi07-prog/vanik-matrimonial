-- Bring the repo in line with prod (drift check, 1 Nov 2026).
--
-- These objects were created in the Supabase dashboard and never written to a
-- migration, so a database rebuilt from this repo would be missing them (member
-- photo and ID uploads would fail, and new tables would not get RLS by default).
-- Each is created only if missing, so on prod this part changes nothing.
--
-- Also: four member RPCs only revoked EXECUTE from PUBLIC, which leaves the
-- direct Supabase default grant to anon in place. Anon calls returned nothing
-- (each looks up the caller profile and finds none), so this is tidy-up, not a fix.

-- 1. Auto-enable RLS on new public tables (dashboard setting).
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END;
$do$;

-- 2. Policies that exist on prod but not in any migration.
DO $do$
BEGIN
  -- Members may read their own payments; nobody writes them from the browser.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stripe_checkout_sessions' AND policyname = 'stripe_checkout_sessions_select_own') THEN
    CREATE POLICY stripe_checkout_sessions_select_own ON public.stripe_checkout_sessions
      FOR SELECT TO authenticated
      USING (auth_user_id = (SELECT auth.uid()) OR public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stripe_checkout_sessions' AND policyname = 'stripe_checkout_sessions_no_direct_write') THEN
    CREATE POLICY stripe_checkout_sessions_no_direct_write ON public.stripe_checkout_sessions
      FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback_tokens' AND policyname = 'feedback_tokens_no_direct_access') THEN
    CREATE POLICY feedback_tokens_no_direct_access ON public.feedback_tokens
      FOR ALL TO authenticated
      USING (false) WITH CHECK (false);
  END IF;

  -- Storage: members upload to and read their own folder only. ID documents
  -- live under {user id}/..., profile photos under {Male|Female}/{user id}/...
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'id_docs_insert') THEN
    CREATE POLICY id_docs_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'id-documents' AND (storage.foldername(name))[1] = (auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'id_docs_select') THEN
    CREATE POLICY id_docs_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'id-documents' AND (storage.foldername(name))[1] = (auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'profile_photos_insert') THEN
    CREATE POLICY profile_photos_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[2] = (auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'profile_photos_select') THEN
    CREATE POLICY profile_photos_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[2] = (auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'profile_photos_update') THEN
    CREATE POLICY profile_photos_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[2] = (auth.uid())::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_service_all') THEN
    CREATE POLICY storage_service_all ON storage.objects
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END;
$do$;

-- 3. Member RPCs: signed-in members only.
REVOKE EXECUTE ON FUNCTION public.member_request_profiles(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.member_requesters_of_me() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_my_linkedin_url(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_renewal_page_visit(text) FROM anon;
