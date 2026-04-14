import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { isAdminUser } from '../lib/auth';
import { invokeFunction, supabase } from '../lib/supabase';

export type SessionSnapshot = {
  user: User | null;
  /** Greeting name (first name for members, email local-part fallback for admins). */
  greetingName: string | null;
  isAdmin: boolean;
  /** False only before first auth resolution completes. */
  ready: boolean;
  refresh: () => Promise<void>;
};

const SessionCtx = createContext<SessionSnapshot | null>(null);

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with provider
export function useSiteSession(): SessionSnapshot {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSiteSession outside SessionProvider');
  return v;
}

function adminGreeting(user: User): string {
  const em = user.email?.split('@')[0]?.trim();
  return em || 'Admin';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [greetingName, setGreetingName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const { data: sessionWrap } = await supabase.auth.getSession();
    const u = sessionWrap.session?.user ?? null;
    if (!u) {
      setUser(null);
      setGreetingName(null);
      setIsAdmin(false);
      setReady(true);
      return;
    }
    setUser(u);
    if (isAdminUser(u)) {
      setIsAdmin(true);
      setGreetingName(adminGreeting(u));
      setReady(true);
      return;
    }
    setIsAdmin(false);
    try {
      const boot = (await invokeFunction('member-bootstrap', {})) as {
        profile?: { first_name?: string | null } | null;
        is_admin?: boolean;
      };
      if (boot.is_admin) {
        setIsAdmin(true);
        setGreetingName(adminGreeting(u));
        setReady(true);
        return;
      }
      const fn = boot.profile?.first_name?.trim();
      if (fn) {
        setGreetingName(fn);
        setReady(true);
        return;
      }
    } catch {
      /* edge may be unavailable in dev */
    }
    const { data: row } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('auth_user_id', u.id)
      .maybeSingle();
    const fn = (row as { first_name?: string | null } | null)?.first_name?.trim();
    setGreetingName(fn || null);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void refresh(), 500);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (t) clearTimeout(t);
    };
  }, [refresh]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Avoid calling member-bootstrap on every token refresh (noise, races). Greeting updates on
      // sign-in/out and explicit profile edits are enough for the header.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        void refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      greetingName,
      isAdmin,
      ready,
      refresh,
    }),
    [user, greetingName, isAdmin, ready, refresh]
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
