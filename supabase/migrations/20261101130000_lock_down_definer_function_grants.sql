-- Security: lock SECURITY DEFINER functions to the roles that call them.
--
-- Earlier migrations only revoked EXECUTE from PUBLIC, but Supabase default
-- privileges grant EXECUTE on new public functions directly to anon and
-- authenticated, so both roles could still call these over the REST rpc endpoint.
-- Verified on prod 1 Nov 2026. Same trap as 20260805170400.
--
-- Impact before this fix: the contact request RPC has no caller check, so
-- any signed-in user could create a request for any requester and candidates and
-- unlock photos and contact details. invoke_scheduled_function let anyone fire
-- cron jobs (purge, archive, reminder emails, cleanup of unverified accounts).
-- The rest allowed minting feedback links, burning coupons, reordering photos.
--
-- The first six are only called by edge functions with the service role client,
-- or by pg_cron as the owner, so they are locked to service_role.
-- viewer_can_browse_gender runs inside the profiles_select_opposite_active RLS
-- policy for authenticated, so only anon loses it.

REVOKE ALL ON FUNCTION public."create_contact_request_atomic"(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public."create_contact_request_atomic"(uuid, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.invoke_scheduled_function(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_scheduled_function(text) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_feedback_token(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feedback_token(uuid, uuid, uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.increment_coupon_use(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coupon_use(text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_profile_photo_order(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_profile_photo_order(uuid, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.assign_referral_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_referral_code(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.viewer_can_browse_gender(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_browse_gender(uuid, text) TO authenticated, service_role;
