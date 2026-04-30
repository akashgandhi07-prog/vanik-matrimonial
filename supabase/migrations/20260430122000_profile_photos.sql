-- Multi-photo support (max 3 per profile) with ordering + primary marker.

CREATE TABLE public.profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  position smallint NOT NULL CHECK (position >= 0 AND position <= 2),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, position),
  UNIQUE (profile_id, storage_path)
);

CREATE UNIQUE INDEX profile_photos_one_primary_per_profile
  ON public.profile_photos (profile_id)
  WHERE is_primary;

CREATE INDEX profile_photos_profile_idx ON public.profile_photos (profile_id, position);

CREATE TRIGGER profile_photos_updated_at
  BEFORE UPDATE ON public.profile_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_photos_select_own_or_admin ON public.profile_photos
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY profile_photos_insert_own_or_admin ON public.profile_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY profile_photos_update_own_or_admin ON public.profile_photos
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY profile_photos_delete_own_or_admin ON public.profile_photos
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_photos TO authenticated;

-- Backfill from existing single-photo records.
INSERT INTO public.profile_photos (profile_id, storage_path, position, is_primary)
SELECT p.id, p.photo_url, 0, true
FROM public.profiles p
WHERE p.photo_url IS NOT NULL
ON CONFLICT (profile_id, storage_path) DO NOTHING;
