import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { isAdminUser } from '../lib/auth';
import { profileNeedsMembershipExpiredRoute } from '../lib/memberStatus';
import { invokeFunction, supabase } from '../lib/supabase';

export type ProfileRow = {
  id: string;
  reference_number: string | null;
  gender: string;
  first_name: string;
  age: number | null;
  created_at: string;
  updated_at: string;
  education: string | null;
  job_title: string | null;
  height_cm: number | null;
  diet: string | null;
  religion: string | null;
  community: string | null;
  nationality: string | null;
  place_of_birth: string | null;
  town_country_of_origin: string | null;
  future_settlement_plans: string | null;
  hobbies: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
  status: string;
  show_on_register: boolean;
  membership_expires_at: string | null;
  rejection_reason: string | null;
};

export type MemberPrivateRow = {
  surname: string;
  email: string;
  mobile_phone: string;
  father_name: string | null;
  mother_name: string | null;
  date_of_birth: string;
};

type MemberCtx = {
  user: User | null;
  profile: ProfileRow | null;
  privateRow: MemberPrivateRow | null;
  loading: boolean;
  candidates: ProfileRow[];
  bookmarks: string[];
  requests: { id: string; created_at: string; candidate_ids: string[]; email_status: string }[];
  feedbackKeys: Set<string>;
  loadAll: () => Promise<void>;
  toggleBookmark: (id: string) => Promise<void>;
};

const Ctx = createContext<MemberCtx | null>(null);

/** Colocated hook for member dashboard context (fast-refresh rule). */
// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with MemberDataProvider
export function useMemberArea() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMemberArea outside provider');
  return v;
}

export function MemberDataProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [privateRow, setPrivateRow] = useState<MemberPrivateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<ProfileRow[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [requests, setRequests] = useState<
    { id: string; created_at: string; candidate_ids: string[]; email_status: string }[]
  >([]);
  const [feedbackKeys, setFeedbackKeys] = useState<Set<string>>(new Set());
  const mountedRef = useRef(false);
  /** Serialize loadAll — concurrent runs (Strict Mode + SIGNED_IN) could finish out of order and leave profile null. */
  const loadChainRef = useRef(Promise.resolve());

  const loadAll = useCallback(async () => {
    const run = async () => {
      setLoading(true);
      // Prefer getSession() right after sign-in — it reads the session the client just stored; getUser()
      // can lag behind navigation and yield no user, which incorrectly sent people to /register.
      const { data: sessionWrap } = await supabase.auth.getSession();
      let u = sessionWrap.session?.user ?? null;
      if (!u) {
        const { data: userWrap } = await supabase.auth.getUser();
        u = userWrap.user ?? null;
      }
      setUser(u ?? null);
      if (!u) {
        setProfile(null);
        setPrivateRow(null);
        setLoading(false);
        return;
      }
      if (isAdminUser(u)) {
        setLoading(false);
        navigate('/admin', { replace: true });
        return;
      }
      // Retries: right after login the JWT may not be attached to PostgREST yet; parallel loadAll calls
      // used to overwrite a successful fetch with an empty one — see loadChainRef serialization above.
      let p: ProfileRow | null = null;
      /** Set only when `member-bootstrap` supplied `member_private` (skip flaky client read). */
      let privateFromBootstrap: MemberPrivateRow | null | undefined = undefined;

      const tryBootstrap = async (): Promise<'admin' | 'profile' | 'none'> => {
        try {
          const boot = (await invokeFunction('member-bootstrap', {})) as {
            profile?: ProfileRow | null;
            member_private?: MemberPrivateRow | null;
            is_admin?: boolean;
          };
          if (boot.is_admin) {
            setLoading(false);
            navigate('/admin', { replace: true });
            return 'admin';
          }
          if (boot.profile) {
            p = boot.profile as ProfileRow;
            privateFromBootstrap = (boot.member_private ?? null) as MemberPrivateRow | null;
            return 'profile';
          }
        } catch (e) {
          console.error('member-bootstrap:', e);
        }
        return 'none';
      };

      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 120 * attempt));
        }
        if (attempt === 2 && !p) {
          await supabase.auth.refreshSession().catch(() => {});
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('auth_user_id', u.id)
          .maybeSingle();
        if (error && error.code !== 'PGRST116') {
          console.error('profiles load:', error.message, error.code);
        }
        if (data) {
          p = data as ProfileRow;
          break;
        }
        if (!p && (attempt === 0 || attempt === 2 || attempt === 5)) {
          const bt = await tryBootstrap();
          if (bt === 'admin') return;
          if (bt === 'profile') break;
        }
      }

      if (!p) {
        const bt = await tryBootstrap();
        if (bt === 'admin') return;
      }

      if (!p) {
        setProfile(null);
        setPrivateRow(null);
        setLoading(false);
        return;
      }
      setProfile(p);
      if (privateFromBootstrap !== undefined) {
        setPrivateRow(privateFromBootstrap);
      } else {
        let { data: m } = await supabase
          .from('member_private')
          .select('*')
          .eq('profile_id', p.id)
          .maybeSingle();
        if (!m) {
          try {
            const boot = (await invokeFunction('member-bootstrap', {})) as {
              profile?: { id?: string } | null;
              member_private?: MemberPrivateRow | null;
            };
            if (boot.profile?.id === p.id && boot.member_private) {
              m = boot.member_private as MemberPrivateRow;
            }
          } catch {
            /* ignore */
          }
        }
        setPrivateRow(m as MemberPrivateRow | null);
      }

      // Status routing for the dashboard is handled in MemberAuthGate (<Navigate />) so we never
      // flash the browse UI or double-navigate. Stop here before loading candidates/bookmarks.
      if (p.status === 'archived') {
        setProfile(null);
        setPrivateRow(null);
        setLoading(false);
        await supabase.auth.signOut();
        navigate('/', { replace: true });
        return;
      }
      if (p.status === 'pending_approval' || p.status === 'rejected' || profileNeedsMembershipExpiredRoute(p)) {
        setLoading(false);
        return;
      }

      const now = new Date().toISOString();
      const myGender = p.gender;
      const myId = p.id;
      const myStatus = p.status;
      async function fetchCandidates() {
        return supabase
          .from('profiles')
          .select('*')
          .neq('gender', myGender)
          .eq('status', 'active')
          .eq('show_on_register', true)
          .gt('membership_expires_at', now);
      }
      let { data: list } = await fetchCandidates();
      // Post-login JWT can lag behind PostgREST; one delayed retry fixes empty browse for valid members.
      if (
        (!list || list.length === 0) &&
        (myStatus === 'active' || myStatus === 'matched')
      ) {
        await new Promise((r) => setTimeout(r, 900));
        const second = await fetchCandidates();
        if (second.data && second.data.length > 0) list = second.data;
      }
      setCandidates((list ?? []) as ProfileRow[]);

      const { data: bm } = await supabase.from('bookmarks').select('bookmarked_id').eq('member_id', myId);
      setBookmarks((bm ?? []).map((x) => x.bookmarked_id as string));

      const { data: rq } = await supabase
        .from('requests')
        .select('id, created_at, candidate_ids, email_status')
        .eq('requester_id', myId)
        .order('created_at', { ascending: false });
      setRequests(rq ?? []);

      const { data: fbRows } = await supabase
        .from('feedback')
        .select('request_id, candidate_id')
        .eq('requester_id', myId);
      setFeedbackKeys(
        new Set((fbRows ?? []).map((r) => `${r.request_id as string}:${r.candidate_id as string}`))
      );

      setLoading(false);
    };

    loadChainRef.current = loadChainRef.current.catch(() => {}).then(run);
    await loadChainRef.current;
  }, [navigate]);

  useEffect(() => {
    void loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once on mount

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        void loadAll();
      }, 400);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (t) clearTimeout(t);
    };
  }, [loadAll]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        // Skip the first SIGNED_IN event which fires on session restore at mount —
        // the mount effect above handles that initial load.
        if (!mountedRef.current) {
          mountedRef.current = true;
          return;
        }
        void loadAll();
      }
      if (event === 'SIGNED_OUT') {
        // Clear stale member state immediately so the auth gate redirects correctly
        setUser(null);
        setProfile(null);
        setPrivateRow(null);
        setCandidates([]);
        setBookmarks([]);
        setRequests([]);
        setFeedbackKeys(new Set());
        navigate('/', { replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAll, navigate]);

  const toggleBookmark = useCallback(
    async (id: string) => {
      if (!profile) return;
      const prev = bookmarks;
      if (prev.includes(id)) {
        setBookmarks((b) => b.filter((x) => x !== id));
        const { error } = await supabase
          .from('bookmarks')
          .delete()
          .eq('member_id', profile.id)
          .eq('bookmarked_id', id);
        if (error) {
          setBookmarks(prev);
          alert(error.message);
        }
      } else {
        setBookmarks((b) => [...b, id]);
        const { error } = await supabase
          .from('bookmarks')
          .insert({ member_id: profile.id, bookmarked_id: id });
        if (error) {
          setBookmarks(prev);
          alert(error.message);
        }
      }
    },
    [profile, bookmarks]
  );

  const value = useMemo(
    () => ({
      user,
      profile,
      privateRow,
      loading,
      candidates,
      bookmarks,
      requests,
      feedbackKeys,
      loadAll,
      toggleBookmark,
    }),
    [
      user,
      profile,
      privateRow,
      loading,
      candidates,
      bookmarks,
      requests,
      feedbackKeys,
      loadAll,
      toggleBookmark,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Guards: use inside MemberDataProvider after load. */
export function MemberAuthGate({ children }: { children: ReactNode }) {
  const { user, profile, loading, loadAll } = useMemberArea();
  if (loading) {
    return (
      <div className="layout-max" style={{ padding: 40 }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Admins do not have member profiles; never send them through /register.
  if (isAdminUser(user)) return <Navigate to="/admin" replace />;
  if (profile?.status === 'pending_approval') {
    return <Navigate to="/registration-pending" replace />;
  }
  if (profile?.status === 'rejected') {
    return <Navigate to="/registration-rejected" replace />;
  }
  if (profile && profileNeedsMembershipExpiredRoute(profile)) {
    return <Navigate to="/membership-expired" replace />;
  }
  if (!profile) {
    return (
      <div className="layout-max" style={{ padding: '48px 16px', maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Could not load your account</h1>
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
          You are signed in, but your membership record did not load. This is often temporary — try
          again, or sign out and sign back in. If it keeps happening, contact{' '}
          <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.
        </p>
        <details style={{ marginTop: 16, fontSize: 14, color: 'var(--color-text-secondary)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Troubleshooting (site owners)</summary>
          <p style={{ lineHeight: 1.55, marginTop: 8 }}>
            Check that <code style={{ fontSize: 13 }}>VITE_SUPABASE_URL</code> points at the project where the
            profile was created, that the <strong>member-bootstrap</strong> Edge Function is deployed with{' '}
            <code style={{ fontSize: 13 }}>SUPABASE_SERVICE_ROLE_KEY</code>, and in SQL that{' '}
            <code style={{ fontSize: 13 }}>profiles.auth_user_id</code> matches{' '}
            <code style={{ fontSize: 13 }}>auth.users.id</code> for this login. Re-applying a full schema file
            without restoring <code style={{ fontSize: 13 }}>profiles</code> data often causes this symptom.
          </p>
        </details>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
          <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
            Try again
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
