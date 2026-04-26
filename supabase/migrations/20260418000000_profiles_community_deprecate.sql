-- Community is no longer collected; clear legacy values and document the column.
-- Safe with NULL under the previous CHECK (NULL does not fail IN (...) checks in PostgreSQL).
UPDATE public.profiles SET community = NULL;

COMMENT ON COLUMN public.profiles.community IS
  'Deprecated - no longer collected in the app. Historical rows were cleared in this migration.';
