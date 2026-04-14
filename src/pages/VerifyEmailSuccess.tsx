import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { supabase } from '../lib/supabase';

export default function VerifyEmailSuccess() {
  const navigate = useNavigate();
  const navigated = useRef(false);

  useEffect(() => {
    function go() {
      if (navigated.current) return;
      navigated.current = true;
      navigate('/register', { replace: true });
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) go();
    });

    const fallback = window.setTimeout(go, 4000);

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
          <p>Your email has been verified. Continuing your registration…</p>
        </div>
      </div>
    </PublicLayout>
  );
}
