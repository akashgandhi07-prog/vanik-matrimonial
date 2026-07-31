-- Recommend-a-friend referral scheme.
-- Every member gets a personal code (VR-XXXXXX). A friend enters it (or arrives
-- via ?ref= link) at registration. When the friend is APPROVED:
--   * the friend gets +1 month membership (on top of any coupon/payment),
--   * the referrer gets +2 months (extended from max(now, current expiry) so a
--     lapsed-but-active-status referrer is revived from today),
--   * both are recorded in public.referrals (one row per referred member, ever).
-- Only referrers whose profile status is 'active' earn the reward; matched or
-- closed accounts have the referral recorded but unrewarded.

ALTER TABLE public.member_private
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by_code text;

COMMENT ON COLUMN public.member_private.referral_code IS
  'This member''s personal recommend-a-friend code (VR-XXXXXX). Generated at backfill or lazily by member-bootstrap.';
COMMENT ON COLUMN public.member_private.referred_by_code IS
  'Referral code this member entered at registration (validated at submit time). Rewarded at approval.';

CREATE UNIQUE INDEX IF NOT EXISTS member_private_referral_code_key
  ON public.member_private (upper(referral_code))
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- UNIQUE: a referred member can only ever produce one reward, even if re-approved.
  referred_profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_used text NOT NULL,
  referrer_months integer,
  referred_months integer,
  rewarded_at timestamptz,
  reward_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.referrals IS
  'One row per accepted referred member. rewarded_at NULL means recorded but not rewarded (e.g. referrer no longer active).';

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_profile_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Writes happen only through Edge Functions (service role). Admins may read;
-- members see their own referral stats via member-bootstrap, not direct reads.
DROP POLICY IF EXISTS "admin_read" ON public.referrals;
CREATE POLICY "admin_read" ON public.referrals FOR SELECT USING (is_admin());

-- Members may see rows where they are the referrer (for the dashboard tally).
-- They never see rows about being referred themselves.
DROP POLICY IF EXISTS "member_read_own" ON public.referrals;
CREATE POLICY "member_read_own" ON public.referrals FOR SELECT USING (
  referrer_profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
);

GRANT SELECT ON TABLE public.referrals TO authenticated;
GRANT ALL ON TABLE public.referrals TO postgres, service_role;

-- Unique-code generator. Alphabet omits 0/O/1/I/L to keep codes easy to read
-- out over the phone or WhatsApp.
CREATE OR REPLACE FUNCTION public.assign_referral_code(p_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  SELECT referral_code INTO v_existing FROM member_private WHERE profile_id = p_profile_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  FOR v_attempt IN 1..20 LOOP
    v_code := 'VR-';
    FOR v_char IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    BEGIN
      UPDATE member_private SET referral_code = v_code
        WHERE profile_id = p_profile_id AND referral_code IS NULL;
      IF FOUND THEN
        RETURN v_code;
      END IF;
      -- Concurrent caller set a code between our SELECT and UPDATE; return theirs.
      SELECT referral_code INTO v_existing FROM member_private WHERE profile_id = p_profile_id;
      RETURN v_existing;
    EXCEPTION WHEN unique_violation THEN
      -- collision: loop and try another code
    END;
  END LOOP;
  RAISE EXCEPTION 'could not generate a unique referral code';
END;
$$;

REVOKE ALL ON FUNCTION public.assign_referral_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_referral_code(uuid) TO service_role;

-- Backfill codes for every existing member so the banner works on day one.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT profile_id FROM public.member_private WHERE referral_code IS NULL LOOP
    PERFORM public.assign_referral_code(r.profile_id);
  END LOOP;
END;
$$;
