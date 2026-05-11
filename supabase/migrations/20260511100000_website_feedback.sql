-- Public website / app feedback (distinct from introduction feedback on public.feedback)
CREATE TABLE public.website_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reporter_email text,
  how_improve text,
  things_good text,
  things_bad text,
  suggestions_future text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.website_feedback IS 'Volunteer suggestions about the matrimonial register site and service; admins only.';

ALTER TABLE public.website_feedback ENABLE ROW LEVEL SECURITY;

-- No policies: Edge Functions use service_role; direct client access is denied.
