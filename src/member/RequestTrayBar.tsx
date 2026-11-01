import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EdgeFunctionHttpError, invokeFunction } from '../lib/supabase';
import { useMemberArea, type ProfileRow } from './memberContext';

type Props = {
  /** Extra profiles (e.g. loaded in MemberSaved) to look up gender/age for tray chips. */
  extraProfiles?: ProfileRow[];
};

export function RequestTrayBar({ extraProfiles = [] }: Props) {
  const navigate = useNavigate();
  const {
    profile,
    candidates,
    tray,
    setTray,
    toggleTray,
    trayMax,
    weeklyCap,
    monthlyCap,
    feedbackBlocking,
    loadAll,
  } = useMemberArea();

  const [trayDrawerOpen, setTrayDrawerOpen] = useState(false);
  const [traySubmitting, setTraySubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    type: 'weekly_limit' | 'monthly_limit' | 'feedback_required' | 'already_requested' | 'generic';
    message: string;
    requestIds?: string[];
  } | null>(null);

  if (!profile || tray.length === 0) return null;

  function findProfile(id: string): ProfileRow | undefined {
    return candidates.find((x) => x.id === id) ?? extraProfiles.find((x) => x.id === id);
  }

  async function submitTray() {
    if (!profile || tray.length === 0 || feedbackBlocking || traySubmitting) return;
    setSubmitError(null);
    const candidate_ids = [...new Set(tray.map((id) => id.trim().toLowerCase()).filter(Boolean))];
    if (candidate_ids.length === 0) {
      setSubmitError({
        type: 'generic',
        message: 'No valid profiles selected. Refresh the page and add people from the list again.',
      });
      return;
    }
    setTraySubmitting(true);
    try {
      const res = (await invokeFunction('submit-contact-request', {
        candidate_ids,
      })) as {
        error?: string;
        message?: string;
        request_id?: string;
        request_ids?: string[];
      };
      if (res.error) {
        throw new EdgeFunctionHttpError(res.message || String(res.error), {
          code: typeof res.error === 'string' ? res.error : undefined,
          requestIds: Array.isArray(res.request_ids)
            ? (res.request_ids as string[]).filter((x): x is string => typeof x === 'string')
            : undefined,
        });
      }
      setTray([]);
      setTrayDrawerOpen(false);
      setSubmitError(null);
      await loadAll();
      navigate('/dashboard/requests', {
        replace: true,
        state: { fromBrowse: true, requestId: res.request_id ?? '' },
      });
    } catch (e) {
      setTrayDrawerOpen(true);
      if (e instanceof EdgeFunctionHttpError) {
        const msg = e.message;
        switch (e.code) {
          case 'monthly_limit':
            setSubmitError({ type: 'monthly_limit', message: msg, requestIds: e.requestIds });
            return;
          case 'weekly_limit':
            setSubmitError({ type: 'weekly_limit', message: msg, requestIds: e.requestIds });
            return;
          case 'feedback_required':
            setSubmitError({ type: 'feedback_required', message: msg, requestIds: e.requestIds });
            return;
          case 'already_requested_this_week':
            setSubmitError({ type: 'already_requested', message: msg });
            return;
          default:
            setSubmitError({ type: 'generic', message: msg });
            return;
        }
      }
      const msg = e instanceof Error ? e.message : 'Request failed';
      if (msg.includes('monthly_limit') || msg.includes('Monthly limit')) {
        setSubmitError({ type: 'monthly_limit', message: msg });
      } else if (msg.includes('weekly_limit') || msg.includes('Weekly limit')) {
        setSubmitError({ type: 'weekly_limit', message: msg });
      } else if (msg.includes('feedback_required') || msg.includes('Outstanding feedback')) {
        setSubmitError({ type: 'feedback_required', message: msg });
      } else if (
        msg.includes('already_requested_this_week') ||
        msg.includes('already requested this profile')
      ) {
        setSubmitError({ type: 'already_requested', message: msg });
      } else {
        setSubmitError({ type: 'generic', message: msg });
      }
    } finally {
      setTraySubmitting(false);
    }
  }

  return (
    <div className="member-request-tray">
      <p className="member-tray-hint">
        {tray.length === 1 ? '1 person selected' : `${tray.length} people selected`} - not requested yet
      </p>
      <p className="member-tray-notice">
        On submit we email {tray.length === 1 ? 'them' : 'each of them'} straight away to say you asked, and share
        your name, profile and contact details. You get {tray.length === 1 ? 'theirs' : 'their details'} too.
      </p>
      <div className="member-tray-collapsed-row">
        <button
          type="button"
          className="btn btn-secondary member-tray-toggle"
          aria-expanded={trayDrawerOpen}
          aria-controls="member-tray-panel"
          onClick={() => setTrayDrawerOpen((o) => !o)}
        >
          {tray.length}/{trayMax}
          {trayDrawerOpen ? ' - hide' : ' - review'}
        </button>
        <button
          type="button"
          className="btn btn-primary member-tray-submit-cta"
          disabled={feedbackBlocking || trayMax === 0 || traySubmitting}
          onClick={() => void submitTray()}
        >
          {traySubmitting ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
      <div
        id="member-tray-panel"
        className={`member-tray-panel ${trayDrawerOpen ? 'member-tray-panel--open' : ''}`}
      >
        <div className="member-tray-chips">
          {tray.map((id) => {
            const c = findProfile(id);
            return (
              <div key={id} className="member-tray-chip">
                <div className="member-tray-chip-meta">
                  <span className="member-tray-chip-name">
                    {[c?.job_title || c?.gender, c?.age != null ? `Age ${c.age}` : null]
                      .filter(Boolean)
                      .join(' · ') || 'Selected'}
                  </span>
                  <button
                    type="button"
                    className="member-tray-chip-remove"
                    title="Remove from request"
                    onClick={() => toggleTray(id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
          A request is a two-way introduction. Everyone you request is emailed as soon as you submit, telling
          them you asked and sharing your name, photo, profile and contact details. Their details are emailed to
          you and listed under My requests. Nobody has to accept first - the introduction happens straight away.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={feedbackBlocking || trayMax === 0 || traySubmitting}
          onClick={() => void submitTray()}
        >
          {traySubmitting ? 'Submitting…' : `Request contact details (${tray.length})`}
        </button>
        {feedbackBlocking && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-warning)' }}>
            Complete outstanding feedback on{' '}
            <Link to="/dashboard/requests" style={{ fontWeight: 600, color: 'inherit' }}>
              My requests
            </Link>{' '}
            before submitting.
          </p>
        )}
        {submitError && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              background:
                submitError.type === 'feedback_required'
                  ? 'rgba(217,119,6,0.12)'
                  : 'rgba(220,38,38,0.08)',
              color:
                submitError.type === 'feedback_required'
                  ? 'var(--color-warning)'
                  : 'var(--color-danger)',
              border: `1px solid ${
                submitError.type === 'feedback_required'
                  ? 'rgba(217,119,6,0.3)'
                  : 'rgba(220,38,38,0.2)'
              }`,
            }}
          >
            {submitError.type === 'feedback_required' && (
              <>
                <strong>Feedback required before new requests.</strong> Please visit{' '}
                <Link to="/dashboard/requests" style={{ color: 'inherit', fontWeight: 600 }}>
                  My requests
                </Link>{' '}
                to submit outstanding feedback.
              </>
            )}
            {submitError.type === 'already_requested' && (
              <>
                <strong>Already requested.</strong> {submitError.message}
              </>
            )}
            {submitError.type === 'weekly_limit' && (
              <>
                <strong>7-day limit reached.</strong> You can add up to {weeklyCap} new{' '}
                {weeklyCap === 1 ? 'person' : 'people'} in any rolling 7-day period (your current allowance). The
                counters at the top of Browse show when the next slot opens.
              </>
            )}
            {submitError.type === 'monthly_limit' && (
              <>
                <strong>Month limit reached.</strong> You can request up to {monthlyCap} distinct{' '}
                {monthlyCap === 1 ? 'person' : 'people'} per calendar month (your current allowance). Counts reset
                on the 1st (UTC).
              </>
            )}
            {submitError.type === 'generic' && (
              <>
                <p style={{ margin: 0 }}>{submitError.message}</p>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={traySubmitting || feedbackBlocking || trayMax === 0}
                    onClick={() => void submitTray()}
                  >
                    Retry request
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
