import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { fetchMyProfileStatusLite, pathForMemberStatus } from '../lib/memberProfileClient';
import { supabase } from '../lib/supabase';

const POLL_MS = 60_000;
const FOLLOW_UP_DAYS = 10;

function daysSinceRegistered(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const started = new Date(createdAt).getTime();
  if (Number.isNaN(started)) return null;
  const elapsedMs = Date.now() - started;
  return Math.max(0, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)));
}

export default function RegistrationPending() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => sessionStorage.getItem('vmr_pending_email') ?? '');
  const [ref, setRef] = useState(() => sessionStorage.getItem('vmr_pending_ref') ?? '');
  const [checking, setChecking] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [statusModalMessage, setStatusModalMessage] = useState<string | null>(null);

  useEffect(() => {
    void syncStatus();
    const interval = window.setInterval(() => void syncStatus(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void syncStatus();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [navigate]);

  async function syncStatus(options?: { manual?: boolean }) {
    const manual = options?.manual === true;
    if (manual) {
      setChecking(true);
      setStatusNote('Checking status...');
    }
    setSyncError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const u = session?.user;
      if (!u) {
        setSyncError('You are signed out. Please sign in again to check your status.');
        return;
      }
      if (u.email) setEmail(u.email);

      const lite = await fetchMyProfileStatusLite(u.id);
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
        return;
      }
      if (manual) {
        const waitedDays = daysSinceRegistered(lite?.created_at ?? null);
        const daysLabel =
          waitedDays == null
            ? 'We could not calculate your registration age yet.'
            : `It has been ${waitedDays} day${waitedDays === 1 ? '' : 's'} since you registered.`;
        const followUp =
          waitedDays != null && waitedDays > FOLLOW_UP_DAYS
            ? `It has been over ${FOLLOW_UP_DAYS} days. Please email mahesh.gandhi@vanikcouncil.uk.`
            : '';
        setStatusModalMessage(
          ['Your account is still under review.', daysLabel, followUp].filter(Boolean).join('\n\n')
        );
      }
      setStatusNote(`Still under review as of ${new Date().toLocaleTimeString()}.`);
    } catch {
      setSyncError('Status check failed. Please try again.');
    } finally {
      if (manual) setChecking(false);
    }
  }

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
            to you within <strong>10 working days</strong> at <strong>{displayEmail}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem', lineHeight: 1.5 }}>
            There&apos;s nothing else you need to do for now - we&apos;ll email you once your membership has been
            approved (or if we need anything further). Look in junk or spam too in case our message was filtered there.
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
          {statusNote && !syncError && (
            <p role="status" style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              {statusNote}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={checking}
              onClick={() => {
                void syncStatus({ manual: true });
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
      {statusModalMessage && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="pending-status-modal-title"
          className="modal-backdrop"
          onClick={() => setStatusModalMessage(null)}
        >
          <div className="card modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 id="pending-status-modal-title">Status update</h3>
            {statusModalMessage.split('\n\n').map((paragraph) => (
              <p key={paragraph} style={{ margin: '0.6rem 0' }}>
                {paragraph}
              </p>
            ))}
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => setStatusModalMessage(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </PublicLayout>
  );
}
