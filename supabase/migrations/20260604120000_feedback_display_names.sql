-- Preserve who feedback was about / from when profile rows are removed (permanent delete nulls FKs).
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS candidate_display_name text,
  ADD COLUMN IF NOT EXISTS requester_display_name text;

COMMENT ON COLUMN public.feedback.candidate_display_name IS
  'Admin audit snapshot: candidate (subject) full name at submit or before profile deletion.';
COMMENT ON COLUMN public.feedback.requester_display_name IS
  'Admin audit snapshot: member who submitted feedback at submit or before profile deletion.';

-- Backfill from live profiles where they still exist.
UPDATE public.feedback f
SET candidate_display_name = trim(concat(p.first_name, ' ', coalesce(mp.surname, '')))
FROM public.profiles p
LEFT JOIN public.member_private mp ON mp.profile_id = p.id
WHERE f.candidate_id = p.id
  AND (f.candidate_display_name IS NULL OR trim(f.candidate_display_name) = '');

UPDATE public.feedback f
SET requester_display_name = trim(concat(p.first_name, ' ', coalesce(mp.surname, '')))
FROM public.profiles p
LEFT JOIN public.member_private mp ON mp.profile_id = p.id
WHERE f.requester_id = p.id
  AND (f.requester_display_name IS NULL OR trim(f.requester_display_name) = '');

-- Orphaned candidate_id: single-candidate contact requests still list the subject in candidate_ids.
UPDATE public.feedback f
SET candidate_display_name = trim(concat(p.first_name, ' ', coalesce(mp.surname, '')))
FROM public.requests r
JOIN public.profiles p ON p.id = r.candidate_ids[1]
LEFT JOIN public.member_private mp ON mp.profile_id = p.id
WHERE f.candidate_id IS NULL
  AND f.request_id = r.id
  AND coalesce(array_length(r.candidate_ids, 1), 0) = 1
  AND (f.candidate_display_name IS NULL OR trim(f.candidate_display_name) = '');

-- Orphaned requester_id: request row may still name the requester.
UPDATE public.feedback f
SET requester_display_name = trim(concat(p.first_name, ' ', coalesce(mp.surname, '')))
FROM public.requests r
JOIN public.profiles p ON p.id = r.requester_id
LEFT JOIN public.member_private mp ON mp.profile_id = p.id
WHERE f.requester_id IS NULL
  AND f.request_id = r.id
  AND r.requester_id IS NOT NULL
  AND (f.requester_display_name IS NULL OR trim(f.requester_display_name) = '');
