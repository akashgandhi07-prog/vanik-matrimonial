-- Optional "How did you hear about us?" answer collected at registration.
--
-- Stored on member_private (admin-only reads) because it is marketing data about
-- the applicant, not something other members should ever see while browsing.
-- Both columns are nullable: members who registered before the question existed,
-- applicants who skip it and admin-added members all stay null ("Not answered").
--
-- submit-registration validates heard_about against the same allowlist and drops
-- anything unknown to null rather than rejecting the registration, so the CHECK
-- below is a backstop, not the main gate. heard_about_other is only kept when
-- heard_about = 'other'. Shown as a breakdown on the admin Analytics page
-- (admin-manage-users action analytics_stats).
--
-- No new table, so no new grants: member_private keeps its existing ones.

ALTER TABLE public.member_private
  ADD COLUMN IF NOT EXISTS heard_about text,
  ADD COLUMN IF NOT EXISTS heard_about_other text;

ALTER TABLE public.member_private
  DROP CONSTRAINT IF EXISTS member_private_heard_about_check,
  ADD CONSTRAINT member_private_heard_about_check CHECK (
    heard_about IS NULL
    OR heard_about IN (
      'friend_family',
      'google',
      'ai_assistant',
      'community',
      'vanik_council',
      'social_media',
      'speed_dating',
      'other'
    )
  );

ALTER TABLE public.member_private
  DROP CONSTRAINT IF EXISTS member_private_heard_about_other_check,
  ADD CONSTRAINT member_private_heard_about_other_check CHECK (
    heard_about_other IS NULL OR length(heard_about_other) <= 100
  );

COMMENT ON COLUMN public.member_private.heard_about IS
  'Optional registration answer to "How did you hear about us?". One of friend_family, google, ai_assistant, community, vanik_council, social_media, speed_dating, other. Null when not answered.';

COMMENT ON COLUMN public.member_private.heard_about_other IS
  'Optional free text (max 100 chars) when heard_about = ''other''. Null otherwise.';
