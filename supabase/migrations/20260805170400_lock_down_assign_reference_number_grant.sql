-- Hygiene: restrict assign_next_reference_number to service_role only.
--
-- 20260413000000_initial_schema.sql GRANTs EXECUTE to service_role but never
-- REVOKEs from PUBLIC, so by default it is also callable by `authenticated`.
-- It is not a C1/C2 vector - a member calling it fires the profiles UPDATE guard
-- (reference_number is denylisted) and raises, and it touches neither PII nor
-- status/membership - but there is no reason for a member to reach it at all.
-- Lock it to the service-role edge path (submit-registration) that legitimately
-- calls it.

REVOKE ALL ON FUNCTION public.assign_next_reference_number(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_next_reference_number(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.assign_next_reference_number(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_next_reference_number(uuid, text) TO service_role;
