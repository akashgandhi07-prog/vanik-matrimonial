import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT,
    });
    // #region agent log
    fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H7',location:'src/pages/ForgotPassword.tsx:onSubmit',message:'forgot password submission completed',data:{emailDomain:email.includes('@')?email.split('@')[1]:'invalid',success:!error,errorMessage:error?.message??null,redirectTarget:REDIRECT},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setLoading(false);
    if (error) setErr(error.message);
    else setMsg('If an account exists for this email, we have sent reset instructions.');
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
              Send reset link
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
