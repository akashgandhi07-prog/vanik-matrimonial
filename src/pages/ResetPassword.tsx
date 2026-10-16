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
  const [linkTimedOut, setLinkTimedOut] = useState(false);
  const [loading, setLoading] = useState(false);
  // Accounts with an authenticator app (admins) must confirm a code before Supabase
  // allows a password change: a recovery link alone only gives an AAL1 session.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    // Unlock the form when a recovery session is present. The listener handles the
    // live PASSWORD_RECOVERY event.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // With detectSessionInUrl the recovery session can be established (and
    // PASSWORD_RECOVERY fired) before this component subscribes - new subscribers
    // get INITIAL_SESSION, not a replay - so the event alone would never flip
    // `ready` for a valid link and the timer below would wrongly show "expired".
    // Proactively check for an existing session too. A genuinely expired/used link
    // has no session, so the expiry path is preserved.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled && data.session) setReady(true);
      })
      .catch(() => {
        /* fall back to the event listener / expiry timer */
      });
    // An expired or already-used link never fires PASSWORD_RECOVERY and has no session.
    // Without this the page would sit on "Checking your reset link..." forever.
    const timer = setTimeout(() => setLinkTimedOut(true), 6000);
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
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
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        let factorId = mfaFactorId;
        if (!factorId) {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          factorId = factors?.totp?.find((f) => f.status === 'verified')?.id ?? null;
          if (!factorId) {
            setError('This account needs a second sign-in step we cannot complete here. Please contact matrimonial@vanikcouncil.uk.');
            return;
          }
          setMfaFactorId(factorId);
        }
        const code = mfaCode.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) {
          setError('Enter the 6-digit code from your authenticator app to confirm the change.');
          return;
        }
        const { error: mfaErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
        if (mfaErr) {
          setError('That code did not work. Check your authenticator app and try again.');
          return;
        }
      }
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
          {!ready && linkTimedOut ? (
            <>
              <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                This password reset link has expired or has already been used. Reset links can only be
                used once, and they must be opened in the same browser you requested them from.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                <a className="btn btn-primary" href="/forgot-password">
                  Request a new link
                </a>
                <a className="btn btn-secondary" href="/login">
                  Back to sign in
                </a>
              </div>
            </>
          ) : !ready ? (
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
              {mfaFactorId && (
                <div>
                  <label className="label" htmlFor="mfa-code">
                    Authenticator code
                  </label>
                  <input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
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
