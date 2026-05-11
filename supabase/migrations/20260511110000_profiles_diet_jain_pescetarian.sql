-- Align profiles.diet with registration / member UI (Register, browse filters, admin edit).

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_diet_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_diet_check CHECK (
    diet IS NULL OR diet IN ('Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian')
  );

COMMENT ON CONSTRAINT profiles_diet_check ON public.profiles IS 'Diet preference; must match Edge Function validation and front-end DIET_OPTIONS.';
