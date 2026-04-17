-- Atomic coupon-use increment called from submit-registration Edge Function.
-- Uses an UPDATE rather than a read-modify-write so concurrent registrations
-- with the same coupon code cannot both slip through max_uses enforcement.

CREATE OR REPLACE FUNCTION public.increment_coupon_use(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.coupons
  SET use_count = use_count + 1
  WHERE code = p_code;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_coupon_use(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_coupon_use(text) TO service_role;
