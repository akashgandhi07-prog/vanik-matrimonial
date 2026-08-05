-- Members can tidy their own requests list once feedback has been given.
-- Archiving is personal and invisible to the other member: it never affects
-- quotas, browse badges, or the other side's view.
CREATE TABLE public.member_archived_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
  -- 'made': a request this member sent. 'received': someone requested them.
  direction text NOT NULL CHECK (direction IN ('made', 'received')),
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, request_id, direction)
);

COMMENT ON TABLE public.member_archived_requests IS
  'Per-member tidy-up of their own requests lists; requires feedback first. Never affects quotas or the other member.';

CREATE INDEX member_archived_requests_member_idx ON public.member_archived_requests (member_id);

ALTER TABLE public.member_archived_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_archived_requests_select_own ON public.member_archived_requests
  FOR SELECT TO authenticated
  USING (member_id = public.current_profile_id() OR public.is_admin());

CREATE POLICY member_archived_requests_insert_own ON public.member_archived_requests
  FOR INSERT TO authenticated
  WITH CHECK (member_id = public.current_profile_id());

CREATE POLICY member_archived_requests_delete_own ON public.member_archived_requests
  FOR DELETE TO authenticated
  USING (member_id = public.current_profile_id());

GRANT SELECT, INSERT, DELETE ON public.member_archived_requests TO authenticated;
