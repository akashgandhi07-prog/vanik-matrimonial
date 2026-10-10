-- Optional LinkedIn profile link, shared only once an introduction is made.
--
-- Stored on member_private (never on profiles) because a LinkedIn page reveals a
-- member's full name, and profiles is readable while browsing. It travels with
-- the phone number and email: the two introduction RPCs below return it, and the
-- introduction email includes it (supabase/functions/_shared/introduction.ts).
--
-- Members cannot UPDATE member_private directly (admin-only policy), so they set
-- their own link through set_my_linkedin_url(). The app normalises input to
-- https://www.linkedin.com/in/<handle> before saving; the CHECK enforces that.

ALTER TABLE public.member_private
  ADD COLUMN linkedin_url text
  CONSTRAINT member_private_linkedin_url_check CHECK (
    linkedin_url IS NULL
    OR (
      length(linkedin_url) <= 200
      AND linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]{3,100}/?$'
    )
  );

COMMENT ON COLUMN public.member_private.linkedin_url IS
  'Optional, member-supplied. Normalised https://www.linkedin.com/in/<handle>. Shared only with members they are introduced to.';

CREATE OR REPLACE FUNCTION public.set_my_linkedin_url(p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid := public.current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.member_private
  SET linkedin_url = NULLIF(btrim(p_url), '')
  WHERE profile_id = v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_linkedin_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_linkedin_url(text) TO authenticated;

-- Introduction RPCs: return type changes, so drop and recreate with linkedin_url.
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
  linkedin_url text
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
    mp.linkedin_url
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
  linkedin_url text
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
    mp.linkedin_url
  FROM public.requests r
  JOIN public.profiles p ON p.id = r.requester_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  WHERE public.current_profile_id() = ANY (r.candidate_ids)
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_requesters_of_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_requesters_of_me() TO authenticated;
