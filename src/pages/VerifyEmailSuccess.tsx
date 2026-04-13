import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function VerifyEmailSuccess() {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => navigate('/register', { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 520, marginTop: 48 }}>
        <div className="card">
          <h1>Email verified</h1>
          <p>Your email has been verified. Continuing your registration…</p>
        </div>
      </div>
    </PublicLayout>
  );
}
