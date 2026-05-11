-- Atomic reorder for profile_photos: avoids UNIQUE(profile_id, position) violations
-- when swapping positions via sequential ORM updates.

CREATE OR REPLACE FUNCTION public.apply_profile_photo_order(
  p_profile_id uuid,
  p_photo_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected int;
  got int;
BEGIN
  SELECT count(*)::int INTO expected FROM public.profile_photos WHERE profile_id = p_profile_id;
  got := coalesce(array_length(p_photo_ids, 1), 0);
  IF expected = 0 OR got != expected THEN
    RAISE EXCEPTION 'photo order mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_photo_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.profile_photos p
      WHERE p.id = x.id AND p.profile_id = p_profile_id
    )
  ) THEN
    RAISE EXCEPTION 'unknown photo id';
  END IF;

  UPDATE public.profile_photos p
  SET position = (o.ord::smallint - 1)
  FROM unnest(p_photo_ids) WITH ORDINALITY AS o(id, ord)
  WHERE p.id = o.id AND p.profile_id = p_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_profile_photo_order(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_profile_photo_order(uuid, uuid[]) TO service_role;
