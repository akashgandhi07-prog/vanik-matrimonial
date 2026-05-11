-- GDPR / UK GDPR: auditable consent at registration submission (Article 7 demonstrability).

ALTER TABLE public.member_private
  ADD COLUMN IF NOT EXISTS consent_contact boolean,
  ADD COLUMN IF NOT EXISTS consent_age boolean,
  ADD COLUMN IF NOT EXISTS consent_privacy_terms boolean,
  ADD COLUMN IF NOT EXISTS consent_privacy_policy_version text,
  ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_submitter_ip_hash text;

COMMENT ON COLUMN public.member_private.consent_contact IS 'Member agreed to sharing contact details for the register service.';
COMMENT ON COLUMN public.member_private.consent_age IS 'Member confirmed aged 18+.';
COMMENT ON COLUMN public.member_private.consent_privacy_terms IS 'Member accepted privacy policy and terms.';
COMMENT ON COLUMN public.member_private.consent_privacy_policy_version IS 'Policy version identifier in force at acceptance (matches published notice).';
COMMENT ON COLUMN public.member_private.consent_recorded_at IS 'UTC time consents were recorded on successful registration submit.';
COMMENT ON COLUMN public.member_private.registration_submitter_ip_hash IS 'Hex HMAC-SHA256 of client IP at submit when REGISTRATION_CONSENT_IP_HMAC_SECRET is set; otherwise null.';
