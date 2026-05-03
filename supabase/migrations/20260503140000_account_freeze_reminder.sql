-- Track when a member freezes (browse_paused) for the one-month reminder email.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS browse_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_freeze_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.profiles.browse_paused_at IS
  'When browse_paused was turned on; cleared when unfrozen.';
COMMENT ON COLUMN public.profiles.account_freeze_reminder_sent_at IS
  'When the freeze reminder email was sent; cleared when unfrozen.';

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

-- Members must not tamper with reminder bookkeeping; service role bypasses guard (auth.uid() NULL).
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

UPDATE public.profiles
SET browse_paused_at = COALESCE(updated_at, created_at, now())
WHERE browse_paused = true
  AND browse_paused_at IS NULL;
