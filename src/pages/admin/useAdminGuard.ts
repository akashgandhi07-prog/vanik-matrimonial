import { useCallback, useEffect, useState } from 'react';
import { isAdminUser } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export type AdminDenyReason = 'anon' | 'not_admin';

export function useAdminGuard() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [mfaOk, setMfaOk] = useState<boolean | null>(null);
  const [denyReason, setDenyReason] = useState<AdminDenyReason | null>(null);

  const refresh = useCallback(async () => {
    setDenyReason(null);
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) {
      setOk(false);
      setDenyReason('anon');
      return;
    }
    if (!isAdminUser(user)) {
      setOk(false);
      setDenyReason('not_admin');
      return;
    }
    setOk(true);
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.all?.filter((f) => f.factor_type === 'totp' && f.status === 'verified');
    setMfaOk(!!totp?.length);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auth/MFA gate on mount
    void refresh();
  }, [refresh]);

  return { ok, mfaOk, denyReason, refresh };
}
