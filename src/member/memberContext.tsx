import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { isAdminUser } from '../lib/auth';
import { supabase } from '../lib/supabase';

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

  const loadAll = useCallback(async () => {
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
    // Brief retries: profile row is expected right after submit-registration; avoids a race where
    // the first PostgREST call runs before the auth JWT is attached to the client.
    let p: ProfileRow | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_user_id', u.id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.error('profiles load:', error.message);
        break;
      }
      if (data) {
        p = data as ProfileRow;
        break;
      }
    }
    if (!p) {
      setProfile(null);
      setPrivateRow(null);
      setLoading(false);
      return;
    }
    setProfile(p);
    const { data: m } = await supabase.from('member_private').select('*').eq('profile_id', p.id).maybeSingle();
    setPrivateRow(m as MemberPrivateRow | null);

    if (p.status === 'pending_approval') {
      setLoading(false);
      navigate('/registration-pending', { replace: true });
      return;
    }
    if (p.status === 'rejected') {
      setLoading(false);
      navigate('/registration-rejected', { replace: true });
      return;
    }
    if (p.status === 'expired') {
      setLoading(false);
      navigate('/membership-expired', { replace: true });
      return;
    }
    if (
      p.status === 'active' &&
      p.membership_expires_at &&
      new Date(p.membership_expires_at) <= new Date()
    ) {
      setLoading(false);
      navigate('/membership-expired', { replace: true });
      return;
    }
    if (p.status === 'archived') {
      // Account was deleted/archived — sign out and return home
      setLoading(false);
      await supabase.auth.signOut();
      navigate('/', { replace: true });
      return;
    }

    const now = new Date().toISOString();
    const { data: list } = await supabase
      .from('profiles')
      .select('*')
      .neq('gender', p.gender)
      .eq('status', 'active')
      .eq('show_on_register', true)
      .gt('membership_expires_at', now);
    setCandidates((list ?? []) as ProfileRow[]);

    const { data: bm } = await supabase.from('bookmarks').select('bookmarked_id').eq('member_id', p.id);
    setBookmarks((bm ?? []).map((x) => x.bookmarked_id as string));

    const { data: rq } = await supabase
      .from('requests')
      .select('id, created_at, candidate_ids, email_status')
      .eq('requester_id', p.id)
      .order('created_at', { ascending: false });
    setRequests(rq ?? []);

    const { data: fbRows } = await supabase
      .from('feedback')
      .select('request_id, candidate_id')
      .eq('requester_id', p.id);
    setFeedbackKeys(
      new Set((fbRows ?? []).map((r) => `${r.request_id as string}:${r.candidate_id as string}`))
    );

    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void loadAll();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAll]);

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
  const { user, profile, loading } = useMemberArea();
  if (loading) {
    return (
      <div className="layout-max" style={{ padding: 40 }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/register" replace />;
  return <>{children}</>;
}
