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

-- 3) How many male profiles are listable by data alone (postgres role bypasses RLS).
--    Result is a single NUMBER row (the count), not one row per profile.
SELECT count(*) AS eligible_male_profiles
FROM public.profiles
WHERE gender = 'Male'
  AND status = 'active'
  AND show_on_register IS TRUE
  AND membership_expires_at IS NOT NULL
  AND membership_expires_at > now();

-- 3b) List eligible *candidates* for someone who seeks men (same rules as app RLS for “male” listings).
--    IMPORTANT: filter on profiles.gender = 'Male'. Do NOT filter on seeking_gender here — that column is
--    “who this row’s member wants to browse”, e.g. many men have seeking_gender = 'Female'.
SELECT id, reference_number, gender, seeking_gender, status, show_on_register, membership_expires_at
FROM public.profiles
WHERE gender = 'Male'
  AND status = 'active'
  AND show_on_register IS TRUE
  AND membership_expires_at IS NOT NULL
  AND membership_expires_at > now()
ORDER BY reference_number
LIMIT 50;

-- 3c) Sanity: counts by gender for “looks listable” rows (still ignores RLS). Expect several Male if table matches UI.
SELECT gender, count(*) AS n
FROM public.profiles
WHERE status = 'active'
  AND show_on_register IS TRUE
  AND membership_expires_at IS NOT NULL
  AND membership_expires_at > now()
GROUP BY gender
ORDER BY gender;

-- 3d) M ref numbers that are not Male in DB (data bug if any rows)
SELECT reference_number, gender, seeking_gender
FROM public.profiles
WHERE reference_number ~ '^M '
  AND gender <> 'Male';

-- 4) Viewer row: edit reference_number. This ALWAYS returns at most ONE row — the member you filter by.
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
