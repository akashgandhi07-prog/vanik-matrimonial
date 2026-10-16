-- purge-archived-accounts has never deleted anyone: deleting the auth user
-- cascades to profiles, and these references (no ON DELETE action) blocked it,
-- most often the 'approved' admin_actions row every member has. The job then
-- logged "success" with purged_count 0 every day.
--
-- Keep the rows for history and statistics but drop the link to the deleted
-- member. All of these columns are already nullable.
ALTER TABLE public.admin_actions
  DROP CONSTRAINT admin_actions_target_profile_id_fkey,
  ADD CONSTRAINT admin_actions_target_profile_id_fkey
    FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.email_log
  DROP CONSTRAINT email_log_recipient_profile_id_fkey,
  ADD CONSTRAINT email_log_recipient_profile_id_fkey
    FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.requests
  DROP CONSTRAINT requests_requester_id_fkey,
  ADD CONSTRAINT requests_requester_id_fkey
    FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.feedback
  DROP CONSTRAINT feedback_candidate_id_fkey,
  ADD CONSTRAINT feedback_candidate_id_fkey
    FOREIGN KEY (candidate_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.feedback
  DROP CONSTRAINT feedback_requester_id_fkey,
  ADD CONSTRAINT feedback_requester_id_fkey
    FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
