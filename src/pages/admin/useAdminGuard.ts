import { useCallback, useEffect, useState } from 'react';
import { adminPowerRole, isAdminUser } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export type AdminDenyReason = 'anon' | 'not_admin';

export function useAdminGuard() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [mfaOk, setMfaOk] = useState<boolean | null>(null);
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
    setMfaOk(!!totp?.length);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auth/MFA gate on mount
    void refresh();
  }, [refresh]);

  return { ok, mfaOk, denyReason, refresh, adminRole };
}
