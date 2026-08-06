-- Refund tracking on Stripe checkout sessions, driven by the admin Payments tab.
-- payment_intent_id is captured by the webhook for new payments; for historical rows
-- the refund function retrieves it from Stripe at refund time.

ALTER TABLE public.stripe_checkout_sessions
  ADD COLUMN payment_intent_id text,
  ADD COLUMN refund_id text,
  ADD COLUMN refund_amount integer,
  ADD COLUMN refunded_at timestamptz,
  ADD COLUMN refunded_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
