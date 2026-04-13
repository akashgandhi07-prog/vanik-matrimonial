-- Stripe Checkout audit + webhook idempotency (service role only; no RLS policies for anon/auth)

CREATE TABLE public.stripe_checkout_sessions (
  checkout_session_id text PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'renewal')),
  payment_status text NOT NULL DEFAULT 'unpaid',
  amount_total integer,
  currency text,
  consumed_at timestamptz,
  renewal_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_checkout_sessions_auth_user_id_idx ON public.stripe_checkout_sessions (auth_user_id);
CREATE INDEX stripe_checkout_sessions_profile_id_idx ON public.stripe_checkout_sessions (profile_id);

ALTER TABLE public.stripe_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER stripe_checkout_sessions_set_updated_at
  BEFORE UPDATE ON public.stripe_checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
