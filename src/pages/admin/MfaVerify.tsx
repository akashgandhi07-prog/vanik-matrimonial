import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Asks an enrolled admin for their authenticator code to raise the session to aal2. */
export function MfaVerify({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) {
        setErr(error.message);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout-max" style={{ maxWidth: 480, marginTop: 48 }}>
      <div className="card">
        <h1>Enter your authenticator code</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Open your authenticator app and enter the 6-digit code for the Vanik admin account.
        </p>
        <form onSubmit={(e) => void verify(e)}>
          <input
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
        </form>
        {err && <p style={{ color: 'var(--color-danger)' }}>{err}</p>}
      </div>
    </div>
  );
}
