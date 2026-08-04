-- Two-way feedback for mutual introductions. `direction` records who wrote the
-- feedback relative to the request's roles:
--   requester_on_candidate (default, all historic rows): the requester wrote
--     about a candidate they requested.
--   candidate_on_requester: the requested member wrote about the person who
--     requested them. requester_id/candidate_id keep their REQUEST roles, so
--     for these rows the subject is requester_id and the author candidate_id.
ALTER TABLE public.feedback
  ADD COLUMN direction text NOT NULL DEFAULT 'requester_on_candidate'
  CHECK (direction IN ('requester_on_candidate', 'candidate_on_requester'));

COMMENT ON COLUMN public.feedback.direction IS
  'requester_on_candidate: requester wrote about a candidate. candidate_on_requester: requested member wrote about their requester. Columns keep request roles either way.';

-- Authors can see their own feedback whichever side they wrote it from.
DROP POLICY feedback_select ON public.feedback;
CREATE POLICY feedback_select ON public.feedback
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (direction = 'requester_on_candidate' AND requester_id = public.current_profile_id())
    OR (direction = 'candidate_on_requester' AND candidate_id = public.current_profile_id())
  );
