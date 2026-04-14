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

  useEffect(() => {
    let cancelled = false;

    async function sync() {
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
              <p style={{ marginTop: 16 }}>
                You can <strong>update your application</strong> (for example a clearer photo or ID), then submit
                again for review.
              </p>
              <Link to="/register" className="btn btn-primary" style={{ marginTop: 8 }}>
                Update and resubmit application
              </Link>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 16 }}>
                If your status changes (for example after resubmission), this page updates when you return to the tab
                or within about a minute.
              </p>
            </>
          )}
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 16 }}>
            If you have questions, please email{' '}
            <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.
          </p>
          <Link to="/" className="btn btn-secondary" style={{ marginTop: 8 }}>
            Back to home
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
