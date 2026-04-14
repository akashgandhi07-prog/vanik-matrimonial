import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { supabase } from '../lib/supabase';

export default function RegistrationPending() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => sessionStorage.getItem('vmr_pending_email') ?? '');
  const [ref, setRef] = useState(() => sessionStorage.getItem('vmr_pending_ref') ?? '');

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const u = session?.user;
      if (u?.email) setEmail(u.email);
      if (u?.id) {
        const { data: p } = await supabase
          .from('profiles')
          .select('reference_number')
          .eq('auth_user_id', u.id)
          .maybeSingle();
        if (p?.reference_number) setRef(p.reference_number);
      }
    })();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  }

  const displayEmail = email.trim() || 'the email you used to register';

  return (
    <PublicLayout>
      <div className="layout-max register-page" style={{ maxWidth: 560, marginTop: 40 }}>
        <div className="register-card prose-safe">
          <h1>Thanks — we&apos;ve got everything</h1>
          <p className="register-lead" style={{ marginBottom: '1rem' }}>
            You&apos;ve submitted your full profile and we&apos;re reviewing your application. We aim to get back
            to you within <strong>five working days</strong> at <strong>{displayEmail}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem', lineHeight: 1.5 }}>
            There&apos;s nothing else you need to do for now — we&apos;ll email you once your membership has been
            approved (or if we need anything further).
          </p>
          {ref && (
            <p style={{ marginTop: '1rem' }}>
              Your reference number is <strong>{ref}</strong>. You may wish to save it for your records.
            </p>
          )}
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginTop: '1.25rem' }}>
            If you were approved by email but still see this page, sign out and sign in again so your account
            picks up the new status.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            Need help? Contact{' '}
            <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
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
