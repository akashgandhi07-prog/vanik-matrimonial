import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resetOk = params.get('reset') === '1';
  const nextRaw = params.get('next');
  const nextPath =
    nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard/browse';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    // #region agent log
    fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H6',location:'src/pages/Login.tsx:onSubmit',message:'login submission completed',data:{emailDomain:email.includes('@')?email.split('@')[1]:'invalid',success:!err,errorMessage:err?.message??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate(nextPath, { replace: true });
  }

  return (
    <PublicLayout>
      <div className="layout-max register-page register-page--narrow" style={{ marginTop: 32 }}>
        <div className="register-card">
          <h1>Member login</h1>
          {resetOk && (
            <p className="badge badge-success" style={{ marginBottom: 12 }}>
              Your password was updated. You can sign in below.
            </p>
          )}
          <form className="register-form-grid" onSubmit={onSubmit}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p style={{ color: 'var(--color-danger)', margin: 0, fontSize: 14 }}>{error}</p>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="register-auth-footer" style={{ marginTop: 4 }}>
            <Link to="/register">Create an account</Link>
            {' · '}
            <Link to="/forgot-password">Forgot password</Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
