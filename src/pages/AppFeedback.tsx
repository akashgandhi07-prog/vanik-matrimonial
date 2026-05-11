import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { useSiteSession } from '../components/SessionContext';
import { EdgeFunctionHttpError, getAccessToken, postFunctionOptionalAuth } from '../lib/supabase';

type FormState = {
  how_improve: string;
  things_good: string;
  things_bad: string;
  suggestions_future: string;
  reporter_email: string;
};

const LIMIT = 4000;

export default function AppFeedback() {
  const { ready, user } = useSiteSession();
  const [form, setForm] = useState<FormState>({
    how_improve: '',
    things_good: '',
    things_bad: '',
    suggestions_future: '',
    reporter_email: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = (await postFunctionOptionalAuth(
        'submit-website-feedback',
        {
          how_improve: form.how_improve,
          things_good: form.things_good,
          things_bad: form.things_bad,
          suggestions_future: form.suggestions_future,
          reporter_email: user ? '' : form.reporter_email.trim(),
        },
        token
      )) as { ok?: boolean; email_sent?: boolean };
      if (res.ok) {
        setDone(true);
        setSentOk(!!res.email_sent);
      }
    } catch (ex) {
      const raw = ex instanceof Error ? ex.message : String(ex);
      if (raw.includes('empty_feedback')) {
        setError('Please write something in at least one of the boxes before submitting.');
      } else if (raw.includes('invalid_email')) {
        setError('Please enter a valid email address, or leave the contact email box empty.');
      } else if (ex instanceof EdgeFunctionHttpError) {
        setError(raw);
      } else {
        setError(`Could not send feedback: ${raw}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const signedInNotice = ready && !!user;

  return (
    <PublicLayout>
      <div className="layout-max" style={{ marginTop: 24, marginBottom: 48 }}>
        <div className="card prose-safe" style={{ maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
          <nav style={{ marginBottom: 16 }}>
            <Link to="/" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)' }}>
              ← Back to home
            </Link>
          </nav>
          <h1 style={{ marginTop: 0 }}>Feedback</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 15 }}>
            Your suggestions help us improve the Vanik Matrimonial Register. Submissions go to the register team at{' '}
            <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>
            {' '}and{' '}
            <a href="mailto:vanikcouncil1@gmail.com">vanikcouncil1@gmail.com</a>
            {signedInNotice ? ' and will be linked to your member account internally' : ''}. Nothing you write here appears
            on your public profile or in search results.
          </p>

          {done ? (
            <div
              role="status"
              style={{
                marginTop: 24,
                padding: 18,
                borderRadius: 8,
                background: 'rgba(22,163,74,0.08)',
                border: '1px solid rgba(22,163,74,0.25)',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>Thank you. Your feedback has been received.</p>
              {!sentOk && (
                <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  We saved your submission. The confirmation email could not be sent just now; the register team may
                  still read your comments in admin.
                </p>
              )}
              <Link to="/" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-block' }}>
                Return home
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} style={{ marginTop: 8 }}>
              {error && (
                <p style={{ color: 'var(--color-danger)', marginBottom: 16 }} role="alert">
                  {error}
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  How could we improve the app or the register experience?
                  <textarea
                    value={form.how_improve}
                    onChange={(e) => set('how_improve', e.target.value)}
                    rows={5}
                    maxLength={LIMIT}
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box' }}
                    aria-describedby="fb-improve-help"
                  />
                  <span id="fb-improve-help" style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Up to {LIMIT} characters
                  </span>
                </label>

                <label style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  What do you feel is working well today?
                  <textarea
                    value={form.things_good}
                    onChange={(e) => set('things_good', e.target.value)}
                    rows={4}
                    maxLength={LIMIT}
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box' }}
                  />
                </label>

                <label style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  What do you feel is not working well (or feels confusing)?
                  <textarea
                    value={form.things_bad}
                    onChange={(e) => set('things_bad', e.target.value)}
                    rows={4}
                    maxLength={LIMIT}
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box' }}
                  />
                </label>

                <label style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  Ideas or suggestions for the future
                  <textarea
                    value={form.suggestions_future}
                    onChange={(e) => set('suggestions_future', e.target.value)}
                    rows={4}
                    maxLength={LIMIT}
                    style={{ marginTop: 8, width: '100%', boxSizing: 'border-box' }}
                  />
                </label>

                {!signedInNotice && ready && (
                  <label
                    htmlFor="feedback-reporter-email"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 8,
                      fontSize: 14,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontWeight: 600 }}>
                      Your email <span className="badge badge-muted">optional</span>
                    </span>
                    <input
                      id="feedback-reporter-email"
                      type="email"
                      autoComplete="email"
                      value={form.reporter_email}
                      onChange={(e) => set('reporter_email', e.target.value)}
                      placeholder="your@example.com"
                      aria-describedby="feedback-email-help"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                    <span
                      id="feedback-email-help"
                      style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}
                    >
                      Add an email if you’d like us to reply; leave it empty to stay anonymous.
                    </span>
                  </label>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !ready}
                style={{ marginTop: 24 }}
              >
                {busy ? 'Sending…' : 'Submit feedback'}
              </button>
              {!ready && (
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading session…</p>
              )}
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
