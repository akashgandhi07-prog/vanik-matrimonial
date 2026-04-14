-- Staff-only notes per profile (not on profiles row — avoids accidental exposure via RLS SELECT own).

CREATE TABLE IF NOT EXISTS public.admin_profile_notes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id)
);

CREATE INDEX IF NOT EXISTS admin_profile_notes_updated_at_idx ON public.admin_profile_notes (updated_at DESC);

ALTER TABLE public.admin_profile_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_profile_notes FROM PUBLIC;
GRANT ALL ON public.admin_profile_notes TO postgres, service_role;

COMMENT ON TABLE public.admin_profile_notes IS 'Internal staff notes; read/write only via Edge Functions (service role).';
