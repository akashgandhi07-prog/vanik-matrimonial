-- Extend the member profile-update guard denylist with three sensitive columns.
--
-- enforce_profile_member_update (a BEFORE UPDATE trigger) blocks non-admin members
-- from changing a denylisted set of columns, but the list omitted several sensitive
-- fields, leaving them member-writable via a direct PATCH to the profiles table:
--
--   photo_url                -- moderation bypass: a member could point their public
--                               card at any object, skipping the pending_photo_url /
--                               photo_status review flow (photo_url is only ever set
--                               server-side by member-manage-photos / admin, both
--                               service-role).
--   age                      -- age is DOB-derived (sync_profile_age_from_private);
--                               a member could overwrite it with any value.
--   inactivity_nudge_sent_at -- send-inactivity-nudges rate-limit bookkeeping; a
--                               member could clear it to suppress or trigger nudges.
--
-- Verified against src/pages/MemberMyProfile.tsx: the only columns a member edits
-- directly are education, job_title, hobbies, future_settlement_plans, nationality,
-- town_country_of_origin, height_cm, diet, seeking_gender (profile form) and
-- hidden_reason (pause toggle). None of the three columns added below are edited by
-- the client, and the photo flow writes photo_url via the service-role
-- member-manage-photos function (auth.uid() IS NULL there, so the guard early-returns).
-- Adding them to the denylist therefore breaks no legitimate member edit.
--
-- This is a denylist extension, not a rewrite to an allowlist: the rest of the body
-- is reproduced verbatim from 20260729120000_profile_listing_state.sql.

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
     -- Added: these were previously member-writable.
     OR OLD.photo_url IS DISTINCT FROM NEW.photo_url
     OR OLD.age IS DISTINCT FROM NEW.age
     OR OLD.inactivity_nudge_sent_at IS DISTINCT FROM NEW.inactivity_nudge_sent_at
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
