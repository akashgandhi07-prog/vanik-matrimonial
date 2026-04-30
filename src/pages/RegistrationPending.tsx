import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { fetchMyProfileStatusLite, pathForMemberStatus } from '../lib/memberProfileClient';
import { supabase } from '../lib/supabase';

const POLL_MS = 60_000;

export default function RegistrationPending() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => sessionStorage.getItem('vmr_pending_email') ?? '');
  const [ref, setRef] = useState(() => sessionStorage.getItem('vmr_pending_ref') ?? '');
  const [checking, setChecking] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      setSyncError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const u = session?.user;
        if (!u) return;
        if (u.email) setEmail(u.email);

        const lite = await fetchMyProfileStatusLite(u.id);
        if (cancelled) return;

        if (lite?.reference_number) {
          setRef(lite.reference_number);
          try {
            sessionStorage.setItem('vmr_pending_ref', lite.reference_number);
          } catch {
            /* ignore */
          }
        }

        const next = pathForMemberStatus(lite?.status ?? null);
        if (next && next !== '/registration-pending') {
          navigate(next, { replace: true });
        }
      } catch {
        if (!cancelled) setSyncError('Could not refresh your status right now. Please try again.');
      }
    }

    void sync();
    const interval = window.setInterval(() => void sync(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  }

  const displayEmail = email.trim() || 'the email you used to register';

  return (
    <PublicLayout>
      <div className="layout-max register-page" style={{ maxWidth: 560, marginTop: 40 }}>
        <div className="register-card prose-safe">
          <h1>Thanks - we&apos;ve got everything</h1>
          <p className="register-lead" style={{ marginBottom: '1rem' }}>
            You&apos;ve submitted your full profile and we&apos;re reviewing your application. We aim to get back
            to you within <strong>five working days</strong> at <strong>{displayEmail}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem', lineHeight: 1.5 }}>
            There&apos;s nothing else you need to do for now - we&apos;ll email you once your membership has been
            approved (or if we need anything further).
          </p>
          {ref && (
            <p style={{ marginTop: '1rem' }}>
              Your reference number is <strong>{ref}</strong>. You may wish to save it for your records.
            </p>
          )}
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: '1.25rem' }}>
            If you were approved recently, this page updates when you return to the tab or within about a minute -
            or use <strong>Check status</strong> below.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            Need help? Contact{' '}
            <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.
          </p>
          {syncError && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 14 }}>
              {syncError}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={checking}
              onClick={() => {
                void (async () => {
                  setChecking(true);
                  setSyncError(null);
                  try {
                    const {
                      data: { session },
                    } = await supabase.auth.getSession();
                    const uid = session?.user?.id;
                    if (!uid) return;
                    const lite = await fetchMyProfileStatusLite(uid);
                    const next = pathForMemberStatus(lite?.status ?? null);
                    if (next && next !== '/registration-pending') navigate(next, { replace: true });
                  } catch {
                    setSyncError('Status check failed. Please try again.');
                  } finally {
                    setChecking(false);
                  }
                })();
              }}
            >
              {checking ? 'Checking…' : 'Check status'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
              Sign out
            </button>
            <Link to="/" className="btn btn-secondary">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
