import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { supabase } from '../lib/supabase';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setReady(true);
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
    const { error: err } = await supabase.auth.updateUser({ password });
    // #region agent log
    fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H8',location:'src/pages/ResetPassword.tsx:onSubmit',message:'reset password update completed',data:{ready,passwordLength:password.length,confirmMatches:password===confirm,success:!err,errorMessage:err?.message??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (err) {
      setError(err.message);
      return;
    }
    await supabase.auth.signOut();
    navigate('/login?reset=1', { replace: true });
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
              <button type="submit" className="btn btn-primary">
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
