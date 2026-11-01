-- 1. Keep payment and refund records when a member account is purged.
--
-- stripe_checkout_sessions.auth_user_id cascaded on auth user delete, so every
-- purge (live since 20261017090000) erased the member payment, refund id, refund
-- amount and refunded_by. Stripe still has them but Admin Payments and local
-- accounting lost them. Keep the row and null the link instead, as profile_id
-- already does.

ALTER TABLE public.stripe_checkout_sessions ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE public.stripe_checkout_sessions DROP CONSTRAINT stripe_checkout_sessions_auth_user_id_fkey;
ALTER TABLE public.stripe_checkout_sessions
  ADD CONSTRAINT stripe_checkout_sessions_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

-- 2. Members can no longer write profile_photos rows directly.
--
-- The insert and update policies accepted any storage_path, and serve-photo signs
-- every path in the caller own gallery, so a member could point a row at another
-- member photo and view it before any introduction. Only edge functions
-- (member-manage-photos, submit-registration, admin) write this table, and they
-- use the service role, which bypasses RLS. The delete and select policies stay.

DROP POLICY IF EXISTS profile_photos_insert_own_or_admin ON public.profile_photos;
DROP POLICY IF EXISTS profile_photos_update_own_or_admin ON public.profile_photos;

-- 3. Members can no longer insert feedback directly.
--
-- feedback_insert_own only checked requester_id, so a member could insert rows to
-- clear the outstanding-feedback gate on contact requests, or file fake flags
-- about other members. feedback-flow writes feedback with the service role.

DROP POLICY IF EXISTS feedback_insert_own ON public.feedback;
