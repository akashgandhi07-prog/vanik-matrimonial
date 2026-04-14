import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function VerifyEmailSuccess() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval);
          navigate('/register', { replace: true });
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [navigate]);

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 520, marginTop: 48 }}>
        <div className="card">
          <h1 style={{ color: 'var(--color-success)' }}>Email verified ✓</h1>
          <p>Your email address has been confirmed. You can now complete your registration.</p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            Continuing automatically in {countdown}s…
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => navigate('/register', { replace: true })}
          >
            Continue registration now
          </button>
        </div>
      </div>
    </PublicLayout>
  );
}
