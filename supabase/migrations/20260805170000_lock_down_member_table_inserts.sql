-- Remove the member-facing INSERT policies on profiles, member_private and requests.
--
-- Every legitimate write to these three tables goes through a service-role edge
-- function (verified: submit-registration and admin-add-member insert profiles /
-- member_private via the SUPABASE_SERVICE_ROLE_KEY admin client; contact requests
-- are inserted only inside create_contact_request_atomic, called from
-- submit-contact-request with the service role). Service-role connections bypass
-- RLS entirely, so dropping these policies does NOT affect any real client path --
-- it only removes the direct-from-browser INSERT capability that each policy granted
-- to `authenticated`. A grep of src/ and supabase/functions/ found no client-side
-- .insert() into any of these tables.
--
-- Exploits closed:
--
-- C1 (CRITICAL) -- PII dump via forged requests row.
--   requests_insert_own let any member INSERT a requests row with an arbitrary
--   candidate_ids[] as long as requester_id = current_profile_id(). The
--   member_request_profiles() SECURITY DEFINER RPC then returns mobile / email /
--   father_name / mother_name / surname for every id in candidate_ids, authorizing
--   only on requester_id ownership. All quota/rate limiting lives in the service-role
--   create_contact_request_atomic, so a direct insert bypassed it and let a member
--   read the private contact details of every profile in the register.
--
-- C2 (CRITICAL) -- payment + approval bypass via self-inserted active profile.
--   profiles_insert_self was WITH CHECK (auth_user_id = auth.uid()) with no column
--   restriction, and the enforce_profile_member_update guard is BEFORE UPDATE only
--   (no BEFORE INSERT). A user with no profile could INSERT status='active',
--   membership_expires_at far in the future, hidden_reason=NULL and immediately gain
--   full browse access without paying or being approved.
--
-- MEDIUM -- self-granted quota bonus / forged referral via member_private insert.
--   member_private_insert_own had no column guard, so a direct-API registrant could
--   set contact_request_weekly_bonus / contact_request_monthly_bonus (quota bonuses)
--   or referred_by_code on their own private row.

DROP POLICY IF EXISTS requests_insert_own ON public.requests;
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
DROP POLICY IF EXISTS member_private_insert_own ON public.member_private;

-- requests_select, member_private_select, and the profiles SELECT policies are left
-- unchanged: members must still be able to read their own rows and browse the register.
