import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setErr(null);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Admin authenticator',
    });
    if (error || !data) {
      setErr(error?.message ?? 'Enrol failed');
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
  }

  async function verify() {
    if (!factorId) return;
    setErr(null);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !challenge) {
      setErr(cErr?.message ?? 'Challenge failed');
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (vErr) {
      setErr(vErr.message);
      return;
    }
    onDone();
  }

  return (
    <div className="layout-max" style={{ maxWidth: 480, marginTop: 48 }}>
      <div className="card">
        <h1>Two-factor authentication required</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Administrators must use an authenticator app (TOTP) before accessing the dashboard.
        </p>
        {!qr ? (
          <button type="button" className="btn btn-primary" onClick={() => void start()}>
            Set up authenticator
          </button>
        ) : (
          <>
            <div style={{ margin: '16px 0' }}>
              <img
                src={qr}
                alt="Authenticator setup QR code"
                style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
              />
            </div>
            <input
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void verify()}>
              Verify and continue
            </button>
          </>
        )}
        {err && <p style={{ color: 'var(--color-danger)' }}>{err}</p>}
      </div>
    </div>
  );
}
