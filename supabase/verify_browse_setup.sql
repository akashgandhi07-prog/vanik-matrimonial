-- Browse / RLS verification — run in Supabase SQL Editor on the SAME project as VITE_SUPABASE_URL.
--
-- Browser (JWT / PostgREST): open DevTools → Network → filter "profiles" or "rpc" while loading
-- Member → Browse. Expect 200; response body is a JSON array (length 0 = RLS or no eligible rows).

-- 1) Migration: seeking_gender column present
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'seeking_gender';

-- 2) Policy present (after migrations)
SELECT polname
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass
  AND polname = 'profiles_select_opposite_active';

-- 3) How many male profiles are listable by data alone (postgres role bypasses RLS)
SELECT count(*) AS eligible_male_profiles
FROM public.profiles
WHERE gender = 'Male'
  AND status = 'active'
  AND show_on_register IS TRUE
  AND membership_expires_at IS NOT NULL
  AND membership_expires_at > now();

-- 4) Viewer row: edit reference_number to match your test member
SELECT id,
 reference_number,
       gender,
       seeking_gender,
       status,
       show_on_register,
       membership_expires_at,
       auth_user_id
FROM public.profiles
WHERE reference_number = 'F 2519';

-- 5) Auth link: edit email to the member’s login — auth_id must equal profiles.auth_user_id
SELECT u.id AS auth_id,
       p.id AS profile_id,
       p.reference_number,
       (p.auth_user_id = u.id) AS auth_linked
FROM auth.users u
LEFT JOIN public.profiles p ON p.auth_user_id = u.id
WHERE u.email = 'replace-with-member@email.com';
