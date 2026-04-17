-- Community is no longer collected in the app; allow NULL and drop enum-style CHECK.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_community_check;
