import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { userFacingAuthError } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Only unlock the form when the session was established via a PASSWORD_RECOVERY link.
    // Checking an existing session would let any logged-in user change their password
    // by navigating directly to this URL without having clicked a reset email.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(userFacingAuthError(err));
        return;
      }
      await supabase.auth.signOut();
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 440 }}>
        <div className="card" style={{ marginTop: 40 }}>
          <h1>Choose a new password</h1>
          {!ready ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>Checking your reset link…</p>
          ) : (
            <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
              <div>
                <label className="label" htmlFor="pw">
                  New password
                </label>
                <input
                  id="pw"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="pw2">
                  Confirm password
                </label>
                <input
                  id="pw2"
                  type="password"
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && <p style={{ color: 'var(--color-danger)', margin: 0 }}>{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
