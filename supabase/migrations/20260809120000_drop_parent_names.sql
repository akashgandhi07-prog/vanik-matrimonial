-- Stop collecting, storing and sharing members' parents' names.
--
-- Father's / mother's name were captured at registration, editable in admin,
-- exported in the members CSV, and disclosed to the other member on a mutual
-- introduction (both in-app and in the introduction email). None of that is
-- needed to run introductions, so the columns are dropped outright: this both
-- ends the collection and erases the values already held for every profile.
--
-- Irreversible: the data is gone once this runs. There is no rollback that can
-- restore the values, only one that re-adds the (empty) columns.

-- ---------------------------------------------------------------------------
-- 1. Drop the RPCs that surface the columns (a return type cannot be altered
--    in place, so each is dropped and recreated without the two fields)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.member_request_profiles(uuid[]);
DROP FUNCTION IF EXISTS public.member_requesters_of_me();

-- ---------------------------------------------------------------------------
-- 2. Erase the stored values
-- ---------------------------------------------------------------------------

ALTER TABLE public.member_private
  DROP COLUMN IF EXISTS father_name,
  DROP COLUMN IF EXISTS mother_name;

-- ---------------------------------------------------------------------------
-- 3. Recreate the RPCs, parent names omitted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.member_request_profiles(
  p_request_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  request_id uuid,
  profile_id uuid,
  reference_number text,
  gender text,
  seeking_gender text,
  first_name text,
  age integer,
  created_at timestamptz,
  updated_at timestamptz,
  education text,
  job_title text,
  height_cm integer,
  diet text,
  religion text,
  community text,
  nationality text,
  place_of_birth text,
  town_country_of_origin text,
  future_settlement_plans text,
  hobbies text,
  photo_url text,
  pending_photo_url text,
  photo_status text,
  status text,
  hidden_reason text,
  membership_expires_at timestamptz,
  rejection_reason text,
  full_name text,
  mobile text,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (
    SELECT r.id AS request_id, cid.candidate_id
    FROM public.requests r
    CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
    WHERE r.requester_id = public.current_profile_id()
      AND (
        p_request_ids IS NULL
        OR cardinality(p_request_ids) = 0
        OR r.id = ANY (p_request_ids)
      )
  )
  SELECT
    req.request_id,
    p.id AS profile_id,
    p.reference_number,
    p.gender,
    p.seeking_gender,
    p.first_name,
    p.age,
    p.created_at,
    p.updated_at,
    p.education,
    p.job_title,
    p.height_cm,
    p.diet,
    p.religion,
    p.community,
    p.nationality,
    p.place_of_birth,
    p.town_country_of_origin,
    p.future_settlement_plans,
    p.hobbies,
    p.photo_url,
    p.pending_photo_url,
    p.photo_status,
    p.status,
    p.hidden_reason,
    p.membership_expires_at,
    p.rejection_reason,
    concat_ws(' ', p.first_name, mp.surname) AS full_name,
    mp.mobile_phone AS mobile,
    mp.email
  FROM req
  JOIN public.profiles p ON p.id = req.candidate_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  ORDER BY req.request_id, p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_request_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_request_profiles(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_requesters_of_me()
RETURNS TABLE (
  request_id uuid,
  requested_at timestamptz,
  profile_id uuid,
  reference_number text,
  gender text,
  seeking_gender text,
  first_name text,
  age integer,
  created_at timestamptz,
  updated_at timestamptz,
  education text,
  job_title text,
  height_cm integer,
  diet text,
  religion text,
  community text,
  nationality text,
  place_of_birth text,
  town_country_of_origin text,
  future_settlement_plans text,
  hobbies text,
  photo_url text,
  pending_photo_url text,
  photo_status text,
  status text,
  hidden_reason text,
  membership_expires_at timestamptz,
  full_name text,
  mobile text,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id AS request_id,
    r.created_at AS requested_at,
    p.id AS profile_id,
    p.reference_number,
    p.gender,
    p.seeking_gender,
    p.first_name,
    p.age,
    p.created_at,
    p.updated_at,
    p.education,
    p.job_title,
    p.height_cm,
    p.diet,
    p.religion,
    p.community,
    p.nationality,
    p.place_of_birth,
    p.town_country_of_origin,
    p.future_settlement_plans,
    p.hobbies,
    p.photo_url,
    p.pending_photo_url,
    p.photo_status,
    p.status,
    p.hidden_reason,
    p.membership_expires_at,
    concat_ws(' ', p.first_name, mp.surname) AS full_name,
    mp.mobile_phone AS mobile,
    mp.email
  FROM public.requests r
  JOIN public.profiles p ON p.id = r.requester_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  WHERE public.current_profile_id() = ANY (r.candidate_ids)
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_requesters_of_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_requesters_of_me() TO authenticated;
