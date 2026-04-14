import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function RegistrationPending() {
  const email = sessionStorage.getItem('vmr_pending_email') ?? 'your email';
  const ref = sessionStorage.getItem('vmr_pending_ref') ?? '';

  return (
    <PublicLayout>
      <div className="layout-max register-page" style={{ maxWidth: 560, marginTop: 40 }}>
        <div className="register-card prose-safe">
          <h1>Thank you for registering</h1>
          <p className="register-lead" style={{ marginBottom: '1rem' }}>
            We will review your application within five working days and email you at{' '}
            <strong>{email}</strong>.
          </p>
          {ref && (
            <p>
              Your reference number is <strong>{ref}</strong>. You may wish to save it for your records.
            </p>
          )}
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            You can close this page. If you have already been approved by email but still see this screen,
            try signing out and signing in again so your account picks up the new status.
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            If you need help, contact{' '}
            <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.
          </p>
          <Link to="/" className="btn btn-secondary" style={{ marginTop: 20 }}>
            Back to home
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
