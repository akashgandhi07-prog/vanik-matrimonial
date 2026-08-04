-- Mutual introductions: members can see the full profile and contact details
-- of everyone who has requested THEM (a request is now a two-way introduction).
-- SECURITY DEFINER reads requester private data, but rows are strictly limited
-- to requests naming current_profile_id() as a candidate.
DROP FUNCTION IF EXISTS public.member_requesters_of_me();

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
