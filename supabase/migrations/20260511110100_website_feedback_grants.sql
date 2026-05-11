-- website_feedback was created with RLS and no policies; lock down client role access explicitly (same pattern as admin_profile_notes).

REVOKE ALL ON TABLE public.website_feedback FROM PUBLIC;
GRANT ALL ON TABLE public.website_feedback TO postgres, service_role;
