-- Daily safety net for renewal payments. stripe-webhook has never received a
-- delivery, so renewals paid at Stripe were not being applied. confirm-renewal
-- now applies a renewal when the member returns from Checkout, and this job
-- picks up anyone who paid but never came back (closed the tab, lost signal).
-- 07:45 UTC: after expire-memberships, before send-renewal-reminders, so a
-- member who has paid is not reminded to pay again.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'reconcile-renewals' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'reconcile-renewals',
    '45 7 * * *',
    $cmd$SELECT public.invoke_scheduled_function('reconcile-renewals');$cmd$
  );
END;
$$;
