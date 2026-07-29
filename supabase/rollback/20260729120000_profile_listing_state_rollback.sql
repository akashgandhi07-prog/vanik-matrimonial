-- ROLLBACK for 20260729120000_profile_listing_state.sql
--
-- This file is deliberately NOT in supabase/migrations/ -- it must never run automatically.
-- Run it by hand (SQL editor or psql) only if the listing-state migration has to be undone.
--
-- It restores show_on_register / browse_paused from hidden_reason and puts the 'matched' and
-- 'archived' statuses back. One thing it cannot restore: the original per-row purge deadline
-- for archived accounts, because the old scheme derived that from updated_at, which the
-- forward migration necessarily bumped. Rows closed by the forward migration come back as
-- 'archived' with a fresh updated_at, i.e. their 90-day clock restarts. That is the safe
-- direction to be wrong in (deletion is delayed, never brought forward).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Recreate the old columns and backfill them from hidden_reason
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_on_register boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS browse_paused boolean NOT NULL DEFAULT false;

UPDATE public.profiles
SET browse_paused = (hidden_reason = 'member_paused'),
    show_on_register = (hidden_reason IS NULL);

-- ---------------------------------------------------------------------------
-- 2. Put the status values back
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_hidden_reason_check;

UPDATE public.profiles SET status = 'matched' WHERE hidden_reason = 'matched';
UPDATE public.profiles SET status = 'archived' WHERE status = 'closed';

-- Matched and admin-hidden rows were both show_on_register = false under the old model.
UPDATE public.profiles SET show_on_register = false WHERE status IN ('matched', 'archived');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (
    status IN ('pending_approval', 'active', 'rejected', 'expired', 'archived', 'matched')
  );

DROP INDEX IF EXISTS public.profiles_listed_idx;
DROP INDEX IF EXISTS public.profiles_delete_after_idx;

-- ---------------------------------------------------------------------------
-- 3. Rename the pause timestamps back
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'paused_at'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN paused_at TO browse_paused_at;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'pause_reminder_sent_at'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN pause_reminder_sent_at TO account_freeze_reminder_sent_at;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Restore the old triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS profiles_sync_pause_timestamps ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_sync_pause_timestamps();

CREATE OR REPLACE FUNCTION public.profiles_sync_browse_paused_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.browse_paused IS DISTINCT FROM OLD.browse_paused THEN
    IF NEW.browse_paused THEN
      NEW.browse_paused_at := now();
      NEW.account_freeze_reminder_sent_at := NULL;
    ELSE
      NEW.browse_paused_at := NULL;
      NEW.account_freeze_reminder_sent_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_browse_paused_timestamps ON public.profiles;
CREATE TRIGGER profiles_sync_browse_paused_timestamps
  BEFORE UPDATE OF browse_paused ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_browse_paused_timestamps();

CREATE OR REPLACE FUNCTION public.enforce_profile_member_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT public.is_admin() INTO admin;
  IF admin THEN
    RETURN NEW;
  END IF;
  IF OLD.photo_status IS DISTINCT FROM NEW.photo_status AND NEW.photo_status <> 'pending' THEN
    RAISE EXCEPTION 'Members may only set photo status to pending when submitting a new photo';
  END IF;
  IF OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
     OR OLD.reference_number IS DISTINCT FROM NEW.reference_number
     OR OLD.gender IS DISTINCT FROM NEW.gender
     OR OLD.first_name IS DISTINCT FROM NEW.first_name
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.show_on_register IS DISTINCT FROM NEW.show_on_register
     OR OLD.membership_expires_at IS DISTINCT FROM NEW.membership_expires_at
     OR OLD.last_request_at IS DISTINCT FROM NEW.last_request_at
     OR OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason
     OR OLD.place_of_birth IS DISTINCT FROM NEW.place_of_birth
     OR OLD.religion IS DISTINCT FROM NEW.religion
     OR OLD.community IS DISTINCT FROM NEW.community
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.account_freeze_reminder_sent_at IS DISTINCT FROM NEW.account_freeze_reminder_sent_at
  THEN
    RAISE EXCEPTION 'Members may only update allowed public profile fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_member_update_guard ON public.profiles;
CREATE TRIGGER profiles_member_update_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_member_update();

-- ---------------------------------------------------------------------------
-- 5. Restore the old visibility rules
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.viewer_can_browse_gender(
  viewer_profile_id uuid,
  target_gender text
)
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
      AND viewer.status IN ('active', 'matched')
      AND viewer.membership_expires_at IS NOT NULL
      AND viewer.membership_expires_at > now()
      AND (
        viewer.seeking_gender = 'Both'
        OR viewer.seeking_gender = target_gender
      )
  );
$$;

DROP POLICY IF EXISTS profiles_select_opposite_active ON public.profiles;

CREATE POLICY profiles_select_opposite_active ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      status = 'active'
      AND show_on_register = true
      AND membership_expires_at > now()
      AND public.viewer_can_browse_gender(public.current_profile_id(), gender)
      AND (
        browse_paused = false
        OR EXISTS (
          SELECT 1
          FROM public.requests r
          WHERE r.requester_id = public.current_profile_id()
            AND profiles.id = ANY (r.candidate_ids)
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.browse_opposite_profiles()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id <> public.current_profile_id()
    AND public.viewer_can_browse_gender(public.current_profile_id(), p.gender)
    AND p.status = 'active'
    AND p.show_on_register = true
    AND p.browse_paused = false
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Restore the My Requests RPC signature
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 7. Drop the new columns last
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS hidden_reason,
  DROP COLUMN IF EXISTS delete_after;

COMMIT;
