-- Admin-only timeline: join admin_actions with auth.users for email display.

CREATE OR REPLACE FUNCTION public.admin_actions_for_profile(p_profile_id uuid)
RETURNS TABLE (
  id uuid,
  action_type text,
  notes text,
  created_at timestamptz,
  admin_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT
    a.id,
    a.action_type,
    a.notes,
    a.created_at,
    u.email::text AS admin_email
  FROM public.admin_actions a
  LEFT JOIN auth.users u ON u.id = a.admin_user_id
  WHERE a.target_profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_actions_for_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_actions_for_profile(uuid) TO authenticated;
