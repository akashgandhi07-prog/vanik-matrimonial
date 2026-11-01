-- Comprehensive security hardening (1 Nov 2026):
-- 1. Enforce MFA (aal2) in public.is_admin() so direct PostgREST queries cannot
--    bypass admin 2FA.
-- 2. Harden enforce_profile_member_update() to block member writes to id,
--    pending_photo_url, photo_status, contact_request_quota_bonus, and paused_at,
--    validate member-editable text lengths and height/weight bounds, and pin
--    search_path on all trigger functions.
-- 3. Restrict storage.buckets (profile-photos and id-documents) to 5 MB and
--    image/jpeg + image/png, drop in-place storage.objects UPDATE policies for
--    authenticated users, and enforce folder structure + extensions on INSERT.
-- 4. Close the viewer_can_browse_gender() cross-user oracle, strip internal and
--    moderation columns from browse_opposite_profiles(), member_request_profiles(),
--    and member_requesters_of_me(), and require active/unhidden status on
--    introduction RPCs.
-- 5. Add atomic check_function_rate_limit() RPC for Edge Functions, advisory lock
--    on assign_next_reference_number(), deduplication on log_renewal_page_visit(),
--    uniqueness on feedback per introduction direction, and explicit grants/checks
--    on auxiliary tables.

-- ---------------------------------------------------------------------------
-- 1. Admin check: require app_metadata.is_admin, non-support role, AND aal2 MFA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', '')) IN ('true', 't', '1', 'yes')
     AND coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') <> 'support'
     AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions: pin search_path and lock down member profile updates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_sync_pause_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason THEN
    IF NEW.hidden_reason = 'member_paused' THEN
      NEW.paused_at := now();
      NEW.pause_reminder_sent_at := NULL;
    ELSE
      NEW.paused_at := NULL;
      NEW.pause_reminder_sent_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_profile_pending_since()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    NEW.pending_since := COALESCE(NEW.pending_since, now());
  ELSIF NEW.status IS DISTINCT FROM 'pending' THEN
    NEW.pending_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_profile_member_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  admin boolean;
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  SELECT public.is_admin() INTO admin;
  IF admin THEN
    RETURN NEW;
  END IF;

  -- A member may only move their own listing between "listed" and "paused by me".
  IF OLD.hidden_reason IS DISTINCT FROM NEW.hidden_reason
     AND NOT (
       COALESCE(OLD.hidden_reason, 'member_paused') = 'member_paused'
       AND COALESCE(NEW.hidden_reason, 'member_paused') = 'member_paused'
     )
  THEN
    RAISE EXCEPTION 'Members may only pause or unpause their own listing';
  END IF;

  -- Sensitive, moderation, billing, and identity columns are never member-writable.
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
     OR OLD.reference_number IS DISTINCT FROM NEW.reference_number
     OR OLD.gender IS DISTINCT FROM NEW.gender
     OR OLD.first_name IS DISTINCT FROM NEW.first_name
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.membership_expires_at IS DISTINCT FROM NEW.membership_expires_at
     OR OLD.last_request_at IS DISTINCT FROM NEW.last_request_at
     OR OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason
     OR OLD.place_of_birth IS DISTINCT FROM NEW.place_of_birth
     OR OLD.religion IS DISTINCT FROM NEW.religion
     OR OLD.community IS DISTINCT FROM NEW.community
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.delete_after IS DISTINCT FROM NEW.delete_after
     OR OLD.pause_reminder_sent_at IS DISTINCT FROM NEW.pause_reminder_sent_at
     OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
     OR OLD.pending_photo_url IS DISTINCT FROM NEW.pending_photo_url
     OR OLD.photo_status IS DISTINCT FROM NEW.photo_status
     OR OLD.age IS DISTINCT FROM NEW.age
     OR OLD.inactivity_nudge_sent_at IS DISTINCT FROM NEW.inactivity_nudge_sent_at
     OR OLD.pending_since IS DISTINCT FROM NEW.pending_since
     OR OLD.contact_request_quota_bonus IS DISTINCT FROM NEW.contact_request_quota_bonus
     OR (OLD.paused_at IS DISTINCT FROM NEW.paused_at AND OLD.hidden_reason IS NOT DISTINCT FROM NEW.hidden_reason)
  THEN
    RAISE EXCEPTION 'Members may only update allowed public profile fields';
  END IF;

  -- Bounds and length checks on member-editable fields.
  IF length(coalesce(NEW.education, '')) > 500
     OR length(coalesce(NEW.job_title, '')) > 500
     OR length(coalesce(NEW.hobbies, '')) > 2000
     OR length(coalesce(NEW.future_settlement_plans, '')) > 1000
     OR length(coalesce(NEW.nationality, '')) > 200
     OR length(coalesce(NEW.town_country_of_origin, '')) > 300
     OR coalesce(NEW.education, '') ~ '[<>]'
     OR coalesce(NEW.job_title, '') ~ '[<>]'
     OR coalesce(NEW.hobbies, '') ~ '[<>]'
     OR coalesce(NEW.future_settlement_plans, '') ~ '[<>]'
     OR coalesce(NEW.nationality, '') ~ '[<>]'
     OR coalesce(NEW.town_country_of_origin, '') ~ '[<>]'
  THEN
    RAISE EXCEPTION 'Profile text fields exceed maximum length or contain disallowed characters';
  END IF;

  IF (NEW.height_cm IS NOT NULL AND (NEW.height_cm < 100 OR NEW.height_cm > 250))
     OR (NEW.weight_kg IS NOT NULL AND (NEW.weight_kg < 30 OR NEW.weight_kg > 250))
  THEN
    RAISE EXCEPTION 'Height or weight is out of valid range';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage bucket limits & storage.objects RLS hardening
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png']
WHERE id IN ('profile-photos', 'id-documents');

-- Prevent in-place overwrite of already-approved photos and consolidate policies.
DROP POLICY IF EXISTS profile_photos_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS profile_photos_update ON storage.objects;
DROP POLICY IF EXISTS id_docs_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS id_docs_insert ON storage.objects;
DROP POLICY IF EXISTS profile_photos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS profile_photos_insert ON storage.objects;

CREATE POLICY id_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND coalesce(array_length(storage.foldername(name), 1), 0) = 1
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png')
    AND name NOT LIKE '%..%'
  );

CREATE POLICY profile_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] IN ('Male', 'Female')
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND coalesce(array_length(storage.foldername(name), 1), 0) = 2
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png')
    AND name NOT LIKE '%..%'
  );

-- ---------------------------------------------------------------------------
-- 4. Browse & Introduction RPC hardening
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.viewer_can_browse_gender(viewer_profile_id uuid, target_gender text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles viewer
    WHERE viewer.id = viewer_profile_id
      AND (
        viewer.auth_user_id = (SELECT auth.uid())
        OR (SELECT auth.uid()) IS NULL
        OR public.is_admin()
      )
      AND viewer.status = 'active'
      AND public.membership_is_current(viewer.membership_expires_at)
      AND (
        viewer.seeking_gender = 'Both'
        OR viewer.seeking_gender = target_gender
      )
  );
$$;

REVOKE ALL ON FUNCTION public.viewer_can_browse_gender(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_browse_gender(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.browse_opposite_profiles()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.profiles%ROWTYPE;
  v_me uuid := public.current_profile_id();
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.*
    FROM public.profiles p
    WHERE p.id <> v_me
      AND public.viewer_can_browse_gender(v_me, p.gender)
      AND p.status = 'active'
      AND p.hidden_reason IS NULL
      AND public.membership_is_current(p.membership_expires_at)
      AND NOT EXISTS (
        SELECT 1
        FROM public.member_private mp
        WHERE mp.profile_id = p.id
          AND mp.email LIKE 'vanik-demo-%@example.com'
      )
  LOOP
    -- Strip internal, storage-path, and moderation fields before returning to browser.
    r.auth_user_id := NULL;
    r.photo_url := NULL;
    r.pending_photo_url := NULL;
    r.rejection_reason := NULL;
    r.last_request_at := NULL;
    r.paused_at := NULL;
    r.pause_reminder_sent_at := NULL;
    r.delete_after := NULL;
    r.inactivity_nudge_sent_at := NULL;
    r.pending_since := NULL;
    RETURN NEXT r;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated, service_role;

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
  WITH viewer AS (
    SELECT me.id
    FROM public.profiles me
    WHERE me.id = public.current_profile_id()
      AND me.status = 'active'
      AND coalesce(me.hidden_reason, '') <> 'admin'
      AND public.membership_is_current(me.membership_expires_at)
  ),
  req AS (
    SELECT r.id AS request_id, cid.candidate_id
    FROM public.requests r
    JOIN viewer v ON v.id = r.requester_id
    CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
    WHERE (
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
    NULL::text AS photo_url,
    NULL::text AS pending_photo_url,
    p.photo_status,
    p.status,
    CASE WHEN p.hidden_reason = 'admin' THEN NULL ELSE p.hidden_reason END AS hidden_reason,
    NULL::timestamptz AS membership_expires_at,
    NULL::text AS rejection_reason,
    concat_ws(' ', p.first_name, mp.surname) AS full_name,
    mp.mobile_phone AS mobile,
    mp.email,
    mp.linkedin_url
  FROM req
  JOIN public.profiles p ON p.id = req.candidate_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  WHERE p.status NOT IN ('closed', 'rejected')
    AND coalesce(p.hidden_reason, '') <> 'admin'
  ORDER BY req.request_id, p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_request_profiles(uuid[]) FROM PUBLIC, anon;
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
  WITH viewer AS (
    SELECT me.id
    FROM public.profiles me
    WHERE me.id = public.current_profile_id()
      AND me.status = 'active'
      AND coalesce(me.hidden_reason, '') <> 'admin'
      AND public.membership_is_current(me.membership_expires_at)
  )
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
    NULL::text AS photo_url,
    NULL::text AS pending_photo_url,
    p.photo_status,
    p.status,
    CASE WHEN p.hidden_reason = 'admin' THEN NULL ELSE p.hidden_reason END AS hidden_reason,
    NULL::timestamptz AS membership_expires_at,
    concat_ws(' ', p.first_name, mp.surname) AS full_name,
    mp.mobile_phone AS mobile,
    mp.email,
    mp.linkedin_url
  FROM public.requests r
  JOIN viewer v ON v.id = ANY (r.candidate_ids)
  JOIN public.profiles p ON p.id = r.requester_id
  LEFT JOIN public.member_private mp ON mp.profile_id = p.id
  WHERE p.status NOT IN ('closed', 'rejected')
    AND coalesce(p.hidden_reason, '') <> 'admin'
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.member_requesters_of_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_requesters_of_me() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic rate limiting, reference number locking, and renewal visit dedup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_function_rate_limit(
  p_scope text,
  p_rate_key text,
  p_max integer,
  p_window_ms bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_now timestamptz := now();
  v_window interval := (p_window_ms::text || ' milliseconds')::interval;
BEGIN
  IF coalesce(btrim(p_scope), '') = '' OR coalesce(btrim(p_rate_key), '') = '' OR p_max <= 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.function_rate_limits AS frl (scope, rate_key, attempt_count, window_started_at)
  VALUES (p_scope, p_rate_key, 1, v_now)
  ON CONFLICT (scope, rate_key) DO UPDATE
    SET attempt_count = CASE
          WHEN frl.window_started_at + v_window <= v_now THEN 1
          ELSE frl.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN frl.window_started_at + v_window <= v_now THEN v_now
          ELSE frl.window_started_at
        END
  RETURNING attempt_count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION public.check_function_rate_limit(text, text, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_function_rate_limit(text, text, integer, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.assign_next_reference_number(p_profile_id uuid, p_gender text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  next_num integer;
  max_num integer;
  floor_num integer;
BEGIN
  IF p_gender = 'Male' THEN
    prefix := 'M';
    floor_num := 2541;
  ELSIF p_gender = 'Female' THEN
    prefix := 'F';
    floor_num := 2517;
  ELSE
    RAISE EXCEPTION 'Invalid gender';
  END IF;

  -- Serialize concurrent reference number assignments per gender within the transaction.
  PERFORM pg_advisory_xact_lock(hashtext('assign_next_reference_number:' || prefix));

  SELECT COALESCE(
    MAX(
      (regexp_match(reference_number, '^' || prefix || ' (\d+)$'))[1]::integer
    ),
    floor_num
  )
  INTO max_num
  FROM public.profiles
  WHERE reference_number ~ ('^' || prefix || ' \d+$');

  next_num := max_num + 1;

  UPDATE public.profiles
  SET reference_number = prefix || ' ' || next_num::text
  WHERE id = p_profile_id;

  RETURN prefix || ' ' || next_num::text;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_next_reference_number(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_next_reference_number(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.log_renewal_page_visit(p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_source text := CASE WHEN p_source IN ('email', 'banner', 'expired') THEN p_source ELSE 'direct' END;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = public.current_profile_id();
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Deduplicate repeated calls within a 10-minute window per profile.
  IF EXISTS (
    SELECT 1
    FROM public.renewal_funnel_events rfe
    WHERE rfe.profile_id = v_profile.id
      AND rfe.event = 'page_view'
      AND rfe.created_at > now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.renewal_funnel_events (profile_id, event, source, profile_status, days_to_expiry)
  VALUES (
    v_profile.id,
    'page_view',
    v_source,
    v_profile.status,
    (v_profile.membership_expires_at AT TIME ZONE 'Europe/London')::date
      - (now() AT TIME ZONE 'Europe/London')::date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_renewal_page_visit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_renewal_page_visit(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Auxiliary policies, grants, unused RPC lockdown, and demo session cleanup
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_actions_for_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_actions_for_profile(uuid) TO service_role;

-- All profile_photos mutations go through member-manage-photos; remove direct client DELETE.
DROP POLICY IF EXISTS profile_photos_delete_own_or_admin ON public.profile_photos;

-- Enforce note length on pause_feedback.
DROP POLICY IF EXISTS pause_feedback_insert_own ON public.pause_feedback;
CREATE POLICY pause_feedback_insert_own ON public.pause_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = public.current_profile_id()
    AND length(coalesce(note, '')) <= 1000
  );

-- Require member_archived_requests inserts to reference a request the member is part of.
DROP POLICY IF EXISTS member_archived_requests_insert_own ON public.member_archived_requests;
CREATE POLICY member_archived_requests_insert_own ON public.member_archived_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.current_profile_id()
    AND EXISTS (
      SELECT 1
      FROM public.requests r
      WHERE r.id = request_id
        AND (
          (direction = 'made' AND r.requester_id = member_id)
          OR (direction = 'received' AND member_id = ANY (r.candidate_ids))
        )
    )
  );

-- Explicit table grants for grandfathered tables so clean DB rebuilds have full service_role access.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.feedback_tokens,
  public.stripe_checkout_sessions,
  public.cron_job_runs,
  public.profile_photos,
  public.pause_feedback,
  public.member_archived_requests
TO service_role;

GRANT SELECT ON TABLE
  public.stripe_checkout_sessions,
  public.cron_job_runs
TO authenticated;

-- Drop legacy no-op signup trigger on auth.users.
DROP TRIGGER IF EXISTS auto_admin_on_signup ON auth.users;
DROP FUNCTION IF EXISTS public.auto_promote_admin();

-- Revoke any lingering sessions for demo accounts and hide them from real browse if present.
DELETE FROM auth.sessions
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email LIKE 'vanik-demo-%@example.com'
);
