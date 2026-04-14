-- Allow honest status when email provider is not configured (no false "sent").
ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_email_status_check;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_email_status_check
  CHECK (email_status IN ('pending', 'sent', 'failed', 'bounced', 'skipped'));
