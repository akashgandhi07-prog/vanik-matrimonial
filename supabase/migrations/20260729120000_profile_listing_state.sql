-- Simplify the account-state model.
--
-- Before: visibility on the register was a 4-term AND across three columns with mixed
-- polarity (status = 'active' AND show_on_register = true AND membership_expires_at > now()
-- AND browse_paused = false), and 'archived' meant both "shelved by an admin" and "queued
-- for deletion" -- with the purge clock keyed on updated_at, which the profiles_updated_at
-- trigger bumps on every write, so any later edit silently postponed deletion by 90 days.
--
-- After:
--   status        lifecycle only: pending_approval | active | expired | rejected | closed
--   hidden_reason why they are off the register (NULL = listed): member_paused | matched | admin
--   delete_after  the only thing purge-archived-accounts reads
--
-- Visibility is now: status = 'active' AND hidden_reason IS NULL AND membership_expires_at > now()
--
-- 'matched' moves from status to hidden_reason: it never had lifecycle meaning of its own
-- (expire-memberships, send-renewal-reminders and the Stripe renewable set all treated
-- 'matched' exactly like 'active'); its only real effect was hiding the profile.

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS delete_after timestamptz;

COMMENT ON COLUMN public.profiles.hidden_reason IS
  'Why this profile is off the register. NULL = listed (subject to status and membership). '
  'member_paused = the member paused it themselves; matched = paired off; admin = staff hid them.';
COMMENT ON COLUMN public.profiles.delete_after IS
  'When set, purge-archived-accounts hard-deletes the auth user after this instant. '
  'Set only when a member leaves or lapses beyond retention; cleared on renewal.';

-- ---------------------------------------------------------------------------
-- 2. Backfill, before the status values move
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;

-- This must run before anything else writes to profiles: the archived rows' purge clock
-- lives in updated_at, and the profiles_updated_at trigger resets it on any write. Reading
-- it in the same statement that overwrites it is safe -- SET expressions see the old row.
UPDATE public.profiles
SET status = 'closed',
    delete_after = COALESCE(updated_at, created_at, now()) + interval '90 days'
WHERE status = 'archived';

UPDATE public.profiles
SET hidden_reason = CASE
  WHEN browse_paused THEN 'member_paused'
  WHEN status = 'matched' THEN 'matched'
  WHEN show_on_register = false THEN 'admin'
  ELSE NULL
END;

-- Members were only able to pause while active; keep the timestamps under clearer names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'browse_paused_at'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN browse_paused_at TO paused_at;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'account_freeze_reminder_sent_at'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN account_freeze_reminder_sent_at TO pause_reminder_sent_at;
  END IF;
END
$$;

COMMENT ON COLUMN public.profiles.paused_at IS
  'When hidden_reason became member_paused; cleared when the member unpauses.';
COMMENT ON COLUMN public.profiles.pause_reminder_sent_at IS
  'When the still-paused reminder email was sent; cleared when the member unpauses.';

-- ---------------------------------------------------------------------------
-- 3. Move the status values
-- ---------------------------------------------------------------------------

UPDATE public.profiles SET status = 'active' WHERE status = 'matched';

-- 'admin' is only meaningful for rows that would otherwise be listed. Expired members keep
-- it, so that a staff hide survives a renewal; the rest are already excluded by status.
UPDATE public.profiles
SET hidden_reason = NULL
WHERE hidden_reason = 'admin'
  AND status IN ('pending_approval', 'rejected', 'closed');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (
    status IN ('pending_approval', 'active', 'expired', 'rejected', 'closed')
  );

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_hidden_reason_check CHECK (
    hidden_reason IS NULL OR hidden_reason IN ('member_paused', 'matched', 'admin')
  );

CREATE INDEX IF NOT EXISTS profiles_listed_idx
  ON public.profiles (gender, membership_expires_at)
  WHERE status = 'active' AND hidden_reason IS NULL;

CREATE INDEX IF NOT EXISTS profiles_delete_after_idx
  ON public.profiles (delete_after)
  WHERE delete_after IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Keep the pause timestamps in sync with hidden_reason
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS profiles_sync_browse_paused_timestamps ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_sync_browse_paused_timestamps();

CREATE OR REPLACE FUNCTION public.profiles_sync_pause_timestamps()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE TRIGGER profiles_sync_pause_timestamps
  BEFORE UPDATE OF hidden_reason ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_pause_timestamps();

-- ---------------------------------------------------------------------------
-- 5. Member update guard: members may pause and unpause themselves, nothing more
-- ---------------------------------------------------------------------------

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
  -- A member may only move their own listing between "listed" and "paused by me".
  -- They may not clear a staff hide, a matched flag, or set someone else's reason.
  IF OLD.hidden_reason IS DISTINCT FROM NEW.hidden_reason
     AND NOT (
       COALESCE(OLD.hidden_reason, 'member_paused') = 'member_paused'
       AND COALESCE(NEW.hidden_reason, 'member_paused') = 'member_paused'
     )
  THEN
    RAISE EXCEPTION 'Members may only pause or unpause their own listing';
  END IF;
  IF OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
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
-- 6. Visibility: one predicate, one polarity
-- ---------------------------------------------------------------------------

-- Who may browse is unchanged in effect: 'matched' is no longer a status, and a matched or
-- paused member is still 'active', so they keep their own browsing access either way.
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
      AND viewer.status = 'active'
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
      AND membership_expires_at > now()
      AND public.viewer_can_browse_gender(public.current_profile_id(), gender)
      AND (
        hidden_reason IS NULL
        -- A member's own pause still lets prior requesters see them, as before. A staff
        -- hide and a matched flag stay absolute -- previously both failed the status test.
        OR (
          hidden_reason = 'member_paused'
          AND EXISTS (
            SELECT 1
            FROM public.requests r
            WHERE r.requester_id = public.current_profile_id()
              AND profiles.id = ANY (r.candidate_ids)
          )
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
    AND p.hidden_reason IS NULL
    AND p.membership_expires_at IS NOT NULL
    AND p.membership_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.browse_opposite_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.browse_opposite_profiles() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. My Requests RPC returns the reason instead of the old boolean
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

-- ---------------------------------------------------------------------------
-- 8. Retire the old columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS show_on_register,
  DROP COLUMN IF EXISTS browse_paused;
