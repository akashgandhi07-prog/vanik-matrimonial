-- Fix cron_job_runs RLS: policy was named "admin_all" but used USING (true),
-- allowing any authenticated member to read/write job results. Restrict to admins only.
DROP POLICY IF EXISTS "admin_all" ON public.cron_job_runs;
CREATE POLICY "admin_all" ON public.cron_job_runs FOR ALL USING (is_admin()) WITH CHECK (is_admin());
