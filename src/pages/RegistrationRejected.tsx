import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { fetchMyProfileStatusLite, pathForMemberStatus } from '../lib/memberProfileClient';
import { supabase } from '../lib/supabase';

const POLL_MS = 60_000;

export default function RegistrationRejected() {
  const navigate = useNavigate();
  const [reason, setReason] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      setSyncError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setNoSession(true);
          return;
        }

        const lite = await fetchMyProfileStatusLite(user.id);
        if (cancelled) return;

        if (!lite?.status) {
          setReason((r) => r ?? 'Could not load your profile. Try signing out and back in.');
          return;
        }

        const next = pathForMemberStatus(lite.status);
        if (next && next !== '/registration-rejected') {
          navigate(next, { replace: true });
          return;
        }

        setReason(lite.rejection_reason?.trim() || 'No reason provided.');
      } catch {
        if (!cancelled) setSyncError('Could not refresh your status right now.');
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

  const reasonLower = (reason ?? '').toLowerCase();
  const suggestions = [
    reasonLower.includes('photo') ? 'Upload a clear, recent head-and-shoulders photo in JPG/PNG format.' : null,
    reasonLower.includes('id') || reasonLower.includes('identity')
      ? 'Upload a readable ID image (passport photo page or driving licence).'
      : null,
    reasonLower.includes('name') ? 'Make sure first name, surname, and parent names match your official records.' : null,
    reasonLower.includes('address') || reasonLower.includes('postcode')
      ? 'Check your address and postcode for typos, then submit again.'
      : null,
  ].filter(Boolean) as string[];

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card prose-safe">
          <h1>Application not approved</h1>
          {noSession ? (
            <>
              <p>Please sign in to see the reason your application was not approved.</p>
              <Link to="/login?next=/registration-rejected" className="btn btn-primary" style={{ marginTop: 8 }}>
                Sign in
              </Link>
            </>
          ) : (
            <>
              <p>We were unable to approve your application.</p>
              <p>
                <strong>Reason:</strong> {reason ?? 'Loading…'}
              </p>
              {syncError && (
                <p role="alert" style={{ color: 'var(--color-danger)' }}>
                  {syncError}
                </p>
              )}
              {suggestions.length > 0 && (
                <>
                  <p style={{ marginTop: 16, marginBottom: 8 }}>
                    You can improve your resubmission by checking the points below:
                  </p>
                  <ul style={{ marginTop: 0 }}>
                    {suggestions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              <p style={{ marginTop: 16 }}>
                You can <strong>update your application</strong> (for example a clearer photo or ID), then submit
                again for review.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <Link to="/register" className="btn btn-primary">
                  Update and resubmit application
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={checking}
                  onClick={() => {
                    setChecking(true);
                    setSyncError(null);
                    void (async () => {
                      try {
                        const {
                          data: { user },
                        } = await supabase.auth.getUser();
                        if (!user) return;
                        const lite = await fetchMyProfileStatusLite(user.id);
                        const next = pathForMemberStatus(lite?.status ?? null);
                        if (next && next !== '/registration-rejected') navigate(next, { replace: true });
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
              </div>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 16 }}>
                If your status changes (for example after resubmission), this page updates when you return to the tab
                or within about a minute.
              </p>
            </>
          )}
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 16 }}>
            If you have questions, please email{' '}
            <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.
          </p>
          <Link to="/" className="btn btn-secondary" style={{ marginTop: 8 }}>
            Back to home
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
