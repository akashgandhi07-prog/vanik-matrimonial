-- Diagnostic log behind member-facing error codes. Members only ever see a short code
-- (e.g. VMR-K3F7QP); the technical detail that used to be printed on the error page lives here
-- and is readable by admins only.
CREATE TABLE IF NOT EXISTS public.client_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_code text NOT NULL,
  area text NOT NULL,
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_user_id uuid,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_email text,
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_error_log IS
  'Client-side failures logged with a short reference code shown to the member; admins only.';
COMMENT ON COLUMN public.client_error_log.error_code IS
  'Short reference (VMR-XXXXXX) shown to the member so support can find this row.';
COMMENT ON COLUMN public.client_error_log.area IS
  'Which part of the app failed, e.g. member_profile_load.';

CREATE INDEX IF NOT EXISTS client_error_log_code_idx ON public.client_error_log (error_code);
CREATE INDEX IF NOT EXISTS client_error_log_created_idx ON public.client_error_log (created_at DESC);

ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

-- Writes happen only through the `log-client-error` Edge Function (service role).
-- No member-facing insert/select policy: members must not read one another's diagnostics.
DROP POLICY IF EXISTS "admin_read" ON public.client_error_log;
CREATE POLICY "admin_read" ON public.client_error_log FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "admin_delete" ON public.client_error_log;
CREATE POLICY "admin_delete" ON public.client_error_log FOR DELETE USING (is_admin());

GRANT SELECT, DELETE ON TABLE public.client_error_log TO authenticated;
GRANT ALL ON TABLE public.client_error_log TO postgres, service_role;
