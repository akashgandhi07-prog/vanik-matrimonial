import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { supabase } from '../lib/supabase';

export default function RegistrationRejected() {
  const [reason, setReason] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setNoSession(true);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('rejection_reason')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      setReason(p?.rejection_reason ?? 'No reason provided.');
    });
  }, []);

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card">
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
