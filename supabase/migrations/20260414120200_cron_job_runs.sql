CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running', -- running | success | error
  result jsonb,
  triggered_by text NOT NULL DEFAULT 'schedule' -- schedule | admin
);

CREATE INDEX IF NOT EXISTS cron_job_runs_job_name_idx ON public.cron_job_runs (job_name, started_at DESC);

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;
-- Admin-only access (enforced by service role in edge functions; frontend reads via admin client)
DROP POLICY IF EXISTS "admin_all" ON public.cron_job_runs;
CREATE POLICY "admin_all" ON public.cron_job_runs FOR ALL USING (true);
