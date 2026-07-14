-- Free coupons can grant a limited membership duration (e.g. 3 months free)
-- instead of the standard 12 months. NULL keeps the standard duration.
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS free_months integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_free_months_range'
  ) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_free_months_range
      CHECK (free_months IS NULL OR (free_months >= 1 AND free_months <= 36));
  END IF;
END $$;

COMMENT ON COLUMN public.coupons.free_months IS
  'For free coupons: months of membership granted on approval. NULL = standard 12 months.';
