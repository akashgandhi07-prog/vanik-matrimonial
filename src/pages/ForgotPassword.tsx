import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { userFacingAuthError } from '../lib/auth';
import { supabase } from '../lib/supabase';

const REDIRECT = `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: REDIRECT,
      });
      if (error) {
        setErr(userFacingAuthError(error));
        return;
      }
      setMsg('If an account exists for this email, we have sent reset instructions.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 440 }}>
        <div className="card" style={{ marginTop: 40 }}>
          <h1>Reset password</h1>
          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {err && <p style={{ color: 'var(--color-danger)', margin: 0 }}>{err}</p>}
            {msg && <p style={{ color: 'var(--color-success)', margin: 0 }}>{msg}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p style={{ marginTop: 16 }}>
            <Link to="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
