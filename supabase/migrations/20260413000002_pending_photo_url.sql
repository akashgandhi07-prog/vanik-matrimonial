ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_photo_url text;
