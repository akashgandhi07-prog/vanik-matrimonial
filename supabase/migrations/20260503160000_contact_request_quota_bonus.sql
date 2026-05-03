-- Extra contact-request slots per member (rolling 7-day and calendar-month caps), set by admins.
-- Base limits remain 3 and 6; bonuses add to those caps (DB-enforced max +50 each).
-- (Function replace is in a separate migration so remote `db push` applies each statement reliably.)

ALTER TABLE public.member_private
  ADD COLUMN contact_request_weekly_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN contact_request_monthly_bonus integer NOT NULL DEFAULT 0;

ALTER TABLE public.member_private
  ADD CONSTRAINT member_private_contact_request_weekly_bonus_range
    CHECK (contact_request_weekly_bonus >= 0 AND contact_request_weekly_bonus <= 50),
  ADD CONSTRAINT member_private_contact_request_monthly_bonus_range
    CHECK (contact_request_monthly_bonus >= 0 AND contact_request_monthly_bonus <= 50);
