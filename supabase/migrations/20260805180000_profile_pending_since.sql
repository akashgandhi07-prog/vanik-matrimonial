-- Track when a profile last entered the approval queue.
--
-- The admin "Waiting" column was computed from profiles.created_at (signup time),
-- so a member who was rejected and later re-submitted showed their entire history
-- - including the days they spent sitting in rejected status - as time "waiting"
-- for review. In practice (profile 0611b800, 2026-08-05) a member who had been
-- back in the queue for ~11 hours displayed as waiting 3 days, which made a
-- freshly-cleared queue look neglected.
--
-- pending_since is stamped by trigger whenever status transitions INTO
-- 'pending_approval' (initial signup insert, or a resubmission flipping a
-- rejected row back to pending via the service-role submit-registration
-- function). It is deliberately left untouched on other status changes: it is
-- only read while the row is pending.

ALTER TABLE public.profiles ADD COLUMN pending_since timestamptz;

CREATE OR REPLACE FUNCTION public.set_profile_pending_since()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending_approval'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    NEW.pending_since := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_pending_since ON public.profiles;
CREATE TRIGGER profiles_set_pending_since
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_pending_since();

-- Backfill rows currently in the queue. Signup time is the best approximation we
-- have for them; every future (re)entry into the queue is stamped by the trigger.
UPDATE public.profiles
SET pending_since = created_at
WHERE status = 'pending_approval' AND pending_since IS NULL;

-- Extend the member profile-update guard denylist with pending_since so a member
-- cannot PATCH their own queue timestamp (members cannot change status, so the
-- trigger alone never fires for them; this closes the direct-write path). The
-- body below is reproduced verbatim from
-- 20260805170100_profile_update_guard_sensitive_columns.sql plus the one added
-- line.

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
     OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
     OR OLD.age IS DISTINCT FROM NEW.age
     OR OLD.inactivity_nudge_sent_at IS DISTINCT FROM NEW.inactivity_nudge_sent_at
     -- Added: stamped by set_profile_pending_since only; never member-writable.
     OR OLD.pending_since IS DISTINCT FROM NEW.pending_since
  THEN
    RAISE EXCEPTION 'Members may only update allowed public profile fields';
  END IF;
  RETURN NEW;
END;
$$;
