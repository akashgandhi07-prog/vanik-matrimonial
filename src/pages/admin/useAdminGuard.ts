import { useCallback, useEffect, useState } from 'react';
import { adminPowerRole, isAdminUser } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export type AdminDenyReason = 'anon' | 'not_admin';
/** 'enroll' = no authenticator yet; 'verify' = enrolled but this session has not entered a code. */
export type AdminMfaStep = 'enroll' | 'verify' | null;

export function useAdminGuard() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [mfaOk, setMfaOk] = useState<boolean | null>(null);
  const [mfaStep, setMfaStep] = useState<AdminMfaStep>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState<AdminDenyReason | null>(null);
  const [adminRole, setAdminRole] = useState<'super' | 'support' | null>(null);

  const refresh = useCallback(async () => {
    setDenyReason(null);
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) {
      setOk(false);
      setAdminRole(null);
      setDenyReason('anon');
      return;
    }
    if (!isAdminUser(user)) {
      setOk(false);
      setAdminRole(null);
      setDenyReason('not_admin');
      return;
    }
    setOk(true);
    setAdminRole(adminPowerRole(user));
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.all?.filter((f) => f.factor_type === 'totp' && f.status === 'verified');
    if (!totp?.length) {
      setMfaStep('enroll');
      setMfaFactorId(null);
      setMfaOk(false);
      return;
    }
    // Having an authenticator is not enough: this session must have used it.
    // The admin edge functions check the same aal2 level on every call.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const verified = aal?.currentLevel === 'aal2';
    setMfaStep(verified ? null : 'verify');
    setMfaFactorId(verified ? null : totp[0]!.id);
    setMfaOk(verified);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auth/MFA gate on mount
    void refresh();
  }, [refresh]);

  return { ok, mfaOk, mfaStep, mfaFactorId, denyReason, refresh, adminRole };
}
