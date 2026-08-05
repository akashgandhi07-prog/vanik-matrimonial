import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { fetchPublicFunction, postFunctionOptionalAuth, supabase } from '../lib/supabase';

const CONTACT_OPTS = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['no_response', 'No response'],
] as const;

const RECOMMEND_OPTS = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Unsure'],
] as const;

export default function Feedback() {
  const { requestId, candidateId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  /** 'received' = feedback about the member who requested YOU (mutual introductions). */
  const isReceivedDirection = searchParams.get('direction') === 'received';
  /** Feedback was opened from an Archive action: archive the entry once submitted. */
  const archiveAfter = searchParams.get('archive') === '1';
  const nextParams = [isReceivedDirection ? 'direction=received' : '', archiveAfter ? 'archive=1' : '']
    .filter(Boolean)
    .join('&');
  const nextPath = `/feedback/${requestId}/${candidateId}${nextParams ? `?${nextParams}` : ''}`;

  const [loading, setLoading] = useState(true);
  const [validMagic, setValidMagic] = useState(false);
  const [candidateLabel, setCandidateLabel] = useState('');
  const [sessionOk, setSessionOk] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);

  const [madeContact, setMadeContact] = useState<string>('yes');
  const [recommend, setRecommend] = useState<string>('yes');
  const [notes, setNotes] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId || !candidateId) return;
    void (async () => {
      if (token) {
        try {
          const j = (await fetchPublicFunction(
            `feedback-flow?request_id=${encodeURIComponent(requestId)}&candidate_id=${encodeURIComponent(candidateId)}&token=${encodeURIComponent(token)}`
          )) as { valid?: boolean; magic?: boolean; candidate_label?: string };
          setValidMagic(!!j.valid);
          setCandidateLabel(String(j.candidate_label ?? ''));
          setNeedLogin(!j.valid);
        } catch {
          setNeedLogin(true);
        }
        setLoading(false);
        return;
      }

      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        setNeedLogin(true);
        setLoading(false);
        return;
      }
      setSessionOk(true);
      setNeedLogin(false);
      setCandidateLabel(isReceivedDirection ? 'the member who requested you' : 'this candidate');
      setLoading(false);
    })();
  }, [requestId, candidateId, token, isReceivedDirection]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!requestId || !candidateId) return;
    // Guard against a double submit: with ?archive=1 a second run would insert a
    // duplicate member_archived_requests row and error on the unique constraint.
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const tok = s.session?.access_token ?? null;
      await postFunctionOptionalAuth(
        'feedback-flow',
        {
          token: token ?? undefined,
          request_id: requestId,
          candidate_id: candidateId,
          ...(isReceivedDirection ? { direction: 'candidate_on_requester' } : {}),
          made_contact: madeContact,
          recommend_retain: recommend,
          notes,
          is_flagged: flagged,
        },
        token ? null : tok
      );
      if (archiveAfter && requestId) {
        // Best-effort: the feedback is saved either way, and the member can
        // archive again from the list if this fails.
        const { data: me } = await supabase
          .from('profiles')
          .select('id')
          .eq('auth_user_id', s.session?.user?.id ?? '')
          .maybeSingle();
        if (me?.id) {
          const { error: archErr } = await supabase.from('member_archived_requests').insert({
            member_id: me.id as string,
            request_id: requestId,
            direction: isReceivedDirection ? 'received' : 'made',
          });
          if (archErr) console.warn('archive after feedback:', archErr.message);
        }
      }
      setDone(true);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!requestId || !candidateId) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="layout-max" style={{ padding: 40 }}>
        Loading…
      </div>
    );
  }

  if (needLogin && !token) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ maxWidth: 480, marginTop: 48 }}>
          <div className="card">
            <h1>Sign in required</h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              To submit feedback without a magic link, please sign in as the member who made the request.
            </p>
            <Link to={`/login?next=${encodeURIComponent(nextPath)}`} className="btn btn-primary">
              Sign in
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (token && !validMagic) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ maxWidth: 480, marginTop: 48 }}>
          <div className="card">
            <h1>Link invalid or expired</h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              This feedback link is no longer valid. Sign in to submit feedback from your account.
            </p>
            <Link to={`/login?next=${encodeURIComponent(nextPath)}`} className="btn btn-primary">
              Sign in
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (done) {
    return (
      <div className="layout-max" style={{ maxWidth: 480, marginTop: 48 }}>
        <div className="card">
          <h1>Thank you</h1>
          <p>
            Your feedback has been recorded.
            {archiveAfter ? ' This introduction has been moved to your archived list.' : ''}
          </p>
          {(sessionOk || token) && (
            <Link
              to={archiveAfter ? '/dashboard/requests' : '/dashboard/browse'}
              className="btn btn-primary"
            >
              {archiveAfter ? 'Back to my requests' : 'Back to dashboard'}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Feedback</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {isReceivedDirection ? 'About' : 'Candidate'}: <strong>{candidateLabel}</strong>
        </p>
        <p
          className="prose-safe"
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            padding: '12px 14px',
            background: 'var(--color-surface-muted, #f4f4f5)',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            margin: 0,
          }}
        >
          <strong>Admin &amp; safeguarding purposes only:</strong> your feedback goes directly to the register team and
          is never shared with the candidate - they will not see your name or your answers. We ask for feedback to
          ensure everyone has had a positive experience and to flag any concerns for the committee&apos;s review.
          It also helps us maintain the quality and safety of the register.{' '}
          <strong>Please give it a go</strong> - even a brief response is really helpful.
        </p>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 14 }}>
          <div>
            <span className="label">Did you make contact?</span>
            <select value={madeContact} onChange={(e) => setMadeContact(e.target.value)}>
              {CONTACT_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Recommend retaining this profile on the register?</span>
            <select value={recommend} onChange={(e) => setRecommend(e.target.value)}>
              {RECOMMEND_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} />
          </div>
          <label className="form-checkbox-label">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
            Flag for admin review
          </label>
          {err && <p style={{ color: 'var(--color-danger)' }}>{err}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
