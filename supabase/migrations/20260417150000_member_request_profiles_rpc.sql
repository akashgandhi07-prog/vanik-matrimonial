-- Returns requested candidates' profile + contact details for the current member.
-- SECURITY DEFINER is used to read candidate private data, but access is strictly
-- limited to rows where requester_id = current_profile_id().
DROP FUNCTION IF EXISTS public.member_request_profiles(uuid[]);

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
  show_on_register boolean,
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
    p.show_on_register,
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
