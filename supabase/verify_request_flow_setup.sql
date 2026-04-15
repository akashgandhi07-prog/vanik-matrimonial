-- Request flow reliability verification
-- Run in Supabase SQL editor after applying latest migrations.

-- 1) Ensure atomic request function exists and is executable by service_role only.
SELECT p.oid::regprocedure AS function_signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'create_contact_request_atomic'
  AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid[]';

SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name = 'create_contact_request_atomic'
ORDER BY grantee, privilege_type;

-- 2) Template: choose one active requester and 1-3 active candidate IDs.
-- Replace placeholders before running:
--   <requester_uuid>
--   <candidate_uuid_1>
--   <candidate_uuid_2>
--   <candidate_uuid_3>
--
-- In two SQL editor tabs, run this at the same time:
-- SELECT *
-- FROM public.create_contact_request_atomic(
--   '<requester_uuid>'::uuid,
--   ARRAY['<candidate_uuid_1>'::uuid, '<candidate_uuid_2>'::uuid]
-- );
--
-- Expected under race:
-- - One tab returns request_id (success)
-- - The other returns error_code ('already_requested_this_week' or 'weekly_limit')

-- 3) Confirm no duplicate request writes for that requester/candidate set in the current 7-day window.
-- Replace requester UUID and candidate UUID list as used above.
-- SELECT
--   count(*) AS matching_requests_last_7_days
-- FROM public.requests r
-- WHERE r.requester_id = '<requester_uuid>'::uuid
--   AND r.created_at >= now() - interval '7 days'
--   AND r.candidate_ids @> ARRAY['<candidate_uuid_1>'::uuid]::uuid[];
