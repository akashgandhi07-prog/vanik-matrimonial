-- Admin "Revoke all sessions" did not work: it banned the user for 2 seconds and
-- unbanned them, which leaves every refresh token valid once the ban lapses.
-- Deleting the auth sessions removes their refresh tokens (FK cascade), so no
-- session can be refreshed again. Access tokens already issued stay valid until
-- they expire (JWT expiry, 1 hour by default).
--
-- Service role only: called by admin-manage-users after its super-admin check.

CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO service_role;
