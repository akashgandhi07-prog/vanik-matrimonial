-- Make increment_coupon_use actually enforce max_uses atomically.
--
-- The previous body (20260414120300) did an unconditional
--   UPDATE public.coupons SET use_count = use_count + 1 WHERE code = p_code;
-- so a coupon could be redeemed past its max_uses cap: two concurrent
-- registrations that both pass submit-registration's read-time
-- (use_count < max_uses) check would both increment, and even a single serial
-- redemption of an already-exhausted coupon would push use_count over the limit.
--
-- Fix: only increment when the coupon still has capacity, in the same statement,
-- and return whether the increment happened so the caller can reject an exhausted
-- coupon. NULL max_uses = unlimited. Guarding on use_count < max_uses inside the
-- UPDATE's WHERE makes the check-and-increment atomic under concurrency.
--
-- Signature change: void -> boolean. The only caller
-- (supabase/functions/submit-registration/index.ts) invokes this via
-- `admin.rpc('increment_coupon_use', { p_code })` and ignores the return value,
-- so returning a boolean is backward compatible.
-- FOLLOW-UP (edge function, not changed here): submit-registration should inspect
-- the returned boolean and, when it is false, treat the coupon as spent (re-run
-- payment/coupon validation or reject) instead of granting the free/discounted
-- membership. Without that change the DB will no longer over-count, but the function
-- would still apply the coupon benefit to a registration that lost the race.

DROP FUNCTION IF EXISTS public.increment_coupon_use(text);

CREATE OR REPLACE FUNCTION public.increment_coupon_use(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.coupons
  SET use_count = use_count + 1
  WHERE code = p_code
    AND (max_uses IS NULL OR use_count < max_uses);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_coupon_use(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_coupon_use(text) TO service_role;
