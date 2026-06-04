-- Soft-archive admin-reviewed feedback without losing audit history until explicitly deleted.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.website_feedback
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS feedback_active_submitted_idx
  ON public.feedback (submitted_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS website_feedback_active_submitted_idx
  ON public.website_feedback (submitted_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.feedback.archived_at IS 'When set, hidden from default admin feedback list; hard-delete removes the row.';
COMMENT ON COLUMN public.website_feedback.archived_at IS 'When set, hidden from default admin website feedback list.';
