import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { isAdminUser } from '../lib/auth';
import { invokeFunction, supabase } from '../lib/supabase';

export default function VerifyEmailSuccess() {
  const navigate = useNavigate();
  const navigated = useRef(false);
  const busy = useRef(false);
  /** No session after the retry - the link was opened in another browser or already used. */
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    async function routeAfterSession() {
      if (navigated.current || busy.current) return;
      busy.current = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return;

        if (isAdminUser(session.user)) {
          navigated.current = true;
          navigate('/admin', { replace: true });
          return;
        }

        const uid = session.user.id;
        let status: string | null = null;
        const { data: row } = await supabase
          .from('profiles')
          .select('status')
          .eq('auth_user_id', uid)
          .maybeSingle();
        if (row?.status) status = row.status as string;
        else {
          try {
            const boot = (await invokeFunction('member-bootstrap', {})) as {
              profile?: { status?: string } | null;
            };
            const st = boot.profile?.status;
            if (st) status = st;
          } catch {
            /* edge missing / network */
          }
        }

        navigated.current = true;
        if (!status) {
          navigate('/register', { replace: true });
          return;
        }
        if (status === 'pending_approval') navigate('/registration-pending', { replace: true });
        else if (status === 'rejected') navigate('/registration-rejected', { replace: true });
        else if (status === 'expired' || status === 'archived') navigate('/membership-expired', { replace: true });
        else if (status === 'active' || status === 'matched') {
          navigate('/dashboard/browse', { replace: true });
        } else navigate('/register', { replace: true });
      } finally {
        busy.current = false;
      }
    }

    void routeAfterSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        void routeAfterSession();
      }
    });

    const fallback = window.setTimeout(() => {
      void routeAfterSession().then(() => {
        // Still here means there was no session to route with; offer a way forward rather than
        // leaving people on "Taking you to the right page..." indefinitely.
        if (!navigated.current) setStalled(true);
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(fallback);
    };
  }, [navigate]);

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 520, marginTop: 48 }}>
        <div className="card">
          <h1>Email verified</h1>
          {stalled ? (
            <>
              <p style={{ lineHeight: 1.55 }}>
                Your email is verified. We could not sign you in automatically here - this usually
                happens when the link is opened in a different browser or device from the one you
                registered on. Please sign in to carry on with your registration.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                <a className="btn btn-primary" href="/login">
                  Sign in
                </a>
                <a className="btn btn-secondary" href="/">
                  Back to home
                </a>
              </div>
            </>
          ) : (
            <p>Your email has been verified. Taking you to the right page…</p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
