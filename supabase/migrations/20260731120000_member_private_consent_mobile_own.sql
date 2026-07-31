-- Registration declaration: the mobile number entered is the candidate's own,
-- not a parent's or relative's (long-standing complaint from members who ended
-- up phoning a candidate's parent).

ALTER TABLE public.member_private
  ADD COLUMN IF NOT EXISTS consent_mobile_own boolean;

COMMENT ON COLUMN public.member_private.consent_mobile_own IS
  'Registrant confirmed the mobile number belongs to the candidate themselves, not a parent/relative. Null for members who registered before the checkbox existed (or via admin add).';
