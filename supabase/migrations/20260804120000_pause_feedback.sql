-- Self-reported reason captured when a member pauses their profile, so the
-- register team can see how many pauses mean "found someone here".
CREATE TABLE public.pause_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (
    reason IN ('found_here', 'found_elsewhere', 'taking_break', 'other', 'prefer_not_say')
  ),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pause_feedback IS
  'Why a member paused their profile (self-reported at pause time); read by admins via service role only.';

CREATE INDEX pause_feedback_profile_id_idx ON public.pause_feedback (profile_id);

ALTER TABLE public.pause_feedback ENABLE ROW LEVEL SECURITY;

-- Members may record why THEY paused; there is no member SELECT/UPDATE/DELETE -
-- admin tooling reads through the service role.
CREATE POLICY pause_feedback_insert_own ON public.pause_feedback
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());

GRANT INSERT ON public.pause_feedback TO authenticated;
