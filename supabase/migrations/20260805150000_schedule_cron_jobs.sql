-- Schedule the recurring Edge Functions. Until now no scheduled job had ever
-- run: pg_cron/pg_net were never installed, so cron_job_runs was empty and
-- renewal reminders, feedback reminders, expiry and archiving never fired.
--
-- The shared secret is read from Supabase Vault at execution time (secret name
-- 'vanik_cron_secret', created out of band) so it never appears in git. It must
-- match the CRON_SECRET Edge Function secret; see _shared/cron-guard.ts.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Posts to an Edge Function with the cron secret header. SECURITY DEFINER so
-- the cron job (running as postgres) can read the vault secret.
CREATE OR REPLACE FUNCTION public.invoke_scheduled_function(p_function_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_secret text;
  v_base text := 'https://foltwnahxqlijbwtkhih.supabase.co/functions/v1/';
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'vanik_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'vanik_cron_secret is not set in Vault';
  END IF;

  SELECT net.http_post(
    url := v_base || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_scheduled_function(text) FROM PUBLIC;

-- Idempotent (re)scheduling: unschedule by name first so re-running the
-- migration never creates duplicates.
DO $$
DECLARE
  j record;
  jobs text[][] := ARRAY[
    -- [job/function name, cron schedule (UTC)]
    ARRAY['expire-memberships',            '0 7 * * *'],
    ARRAY['send-feedback-reminders',       '0 8 * * *'],
    ARRAY['send-renewal-reminders',        '15 8 * * *'],
    ARRAY['send-account-freeze-reminders', '30 8 * * *'],
    ARRAY['send-inactivity-nudges',        '0 10 * * 2'],
    ARRAY['archive-lapsed-members',        '0 9 * * 1'],
    ARRAY['purge-archived-accounts',       '0 10 * * *']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(jobs, 1) LOOP
    FOR j IN SELECT jobid FROM cron.job WHERE jobname = jobs[i][1] LOOP
      PERFORM cron.unschedule(j.jobid);
    END LOOP;
    PERFORM cron.schedule(
      jobs[i][1],
      jobs[i][2],
      format('SELECT public.invoke_scheduled_function(%L);', jobs[i][1])
    );
  END LOOP;
END;
$$;
