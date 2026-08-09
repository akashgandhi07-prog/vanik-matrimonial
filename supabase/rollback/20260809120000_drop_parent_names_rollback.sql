-- ROLLBACK for 20260809120000_drop_parent_names.sql
--
-- This file is deliberately NOT in supabase/migrations/ -- it must never run automatically.
-- Run it by hand (SQL editor or psql) only if dropping the parent-name fields has to be undone.
--
-- It restores the SHAPE only. The forward migration dropped the columns, so the stored
-- father's / mother's names are gone and nothing here can bring them back: every row comes
-- back with both fields NULL. The application code that read and wrote them was removed in
-- the same change, so a rollback of this file alone leaves two unused columns behind.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Recreate the columns (empty)
-- ---------------------------------------------------------------------------

ALTER TABLE public.member_private
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text;

-- ---------------------------------------------------------------------------
-- 2. Put the two introduction RPCs back to their pre-migration return types
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.member_request_profiles(uuid[]);
DROP FUNCTION IF EXISTS public.member_requesters_of_me();

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
  email text,
  father_name text,
  mother_name text
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
    mp.email,
    mp.father_name,
    mp.mother_name
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
  email text,
  father_name text,
  mother_name text
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
    mp.email,
    mp.father_name,
    mp.mother_name
  FROM public.requests r
  JOIN public.profiles p ON p.id = r.requester_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  WHERE public.current_profile_id() = ANY (r.candidate_ids)
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_requesters_of_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_requesters_of_me() TO authenticated;

COMMIT;
