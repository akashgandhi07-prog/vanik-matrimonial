-- Keep profiles.age in step with birthdays.
--
-- profiles.age is a stored copy of the member's age. The member_private_sync_age
-- trigger only sets it when date_of_birth is inserted or changed, so nothing ever
-- moved it on when a member had a birthday. By 23 Nov 2026, 53 of 178 profiles
-- (35 active) showed an age a year too low on browse cards, intro emails,
-- WhatsApp intros, the age filter and the admin age bands.
--
-- refresh_profile_ages() recomputes age from date_of_birth for every profile whose
-- stored value is wrong, and returns how many rows it changed. It runs daily just
-- after midnight UTC (before any UK morning browsing), and once now as a backfill.
--
-- The cron job runs without an auth user, so enforce_profile_member_update returns
-- early and allows the write. Only rows that actually differ are touched, so
-- updated_at is not bumped for everyone each night.

CREATE OR REPLACE FUNCTION public.refresh_profile_ages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.profiles p
  SET age = EXTRACT(YEAR FROM AGE(mp.date_of_birth))::integer
  FROM public.member_private mp
  WHERE mp.profile_id = p.id
    AND mp.date_of_birth IS NOT NULL
    AND p.age IS DISTINCT FROM EXTRACT(YEAR FROM AGE(mp.date_of_birth))::integer;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_profile_ages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_profile_ages() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_profile_ages() TO service_role;

-- Backfill the ages that are already stale.
SELECT public.refresh_profile_ages();

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'refresh-profile-ages' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'refresh-profile-ages',
    '5 0 * * *',
    $cmd$SELECT public.refresh_profile_ages();$cmd$
  );
END;
$$;
