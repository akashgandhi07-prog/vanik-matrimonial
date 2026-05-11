import { useCallback, useEffect, useMemo, useState } from 'react';
import { invokeFunction } from '../../lib/supabase';

type FeedbackRow = {
  id: string;
  request_id: string;
  candidate_id: string;
  requester_id: string | null;
  made_contact: string | null;
  recommend_retain: string | null;
  notes: string | null;
  is_flagged: boolean;
  /** DB column is `submitted_at` (not `created_at`). */
  submitted_at: string;
};

type ProfileSummary = {
  id: string;
  first_name: string;
  reference_number: string | null;
};

type GroupedFeedback = {
  candidate: ProfileSummary;
  rows: FeedbackRow[];
};

type WebsiteFeedbackRow = {
  id: string;
  profile_id: string | null;
  reporter_email: string | null;
  how_improve: string | null;
  things_good: string | null;
  things_bad: string | null;
  suggestions_future: string | null;
  submitted_at: string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtDateTimeUtc(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return fmtDate(iso);
  }
}

function truncate(s: string | null, len: number): string {
  if (!s) return '-';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function sectionBlock(title: string, text: string | null) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--color-text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text?.trim() ? text : '—'}
      </div>
    </div>
  );
}

export default function AdminFeedback() {
  const [tab, setTab] = useState<'introductions' | 'website'>('introductions');

  /* --- Introduction feedback --- */
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [introLoading, setIntroLoading] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);

  const loadIntro = useCallback(async () => {
    setIntroLoading(true);
    setIntroError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'list_feedback' })) as {
        feedback?: FeedbackRow[];
        profiles?: Record<string, ProfileSummary>;
      };
      setFeedback((res.feedback ?? []) as FeedbackRow[]);
      setProfiles(res.profiles ?? {});
    } catch (ex) {
      setIntroError(ex instanceof Error ? ex.message : 'Failed to load feedback');
    } finally {
      setIntroLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntro();
  }, [loadIntro]);

  const grouped = useMemo<GroupedFeedback[]>(() => {
    const map = new Map<string, FeedbackRow[]>();
    for (const row of feedback) {
      const list = map.get(row.candidate_id) ?? [];
      list.push(row);
      map.set(row.candidate_id, list);
    }

    const result: GroupedFeedback[] = [];
    for (const [candidateId, rows] of map.entries()) {
      const visibleRows = showFlaggedOnly
        ? rows.filter((r) => r.is_flagged || r.recommend_retain === 'no')
        : rows;
      if (visibleRows.length === 0) continue;
      const candidate = profiles[candidateId] ?? {
        id: candidateId,
        first_name: candidateId,
        reference_number: null,
      };
      result.push({ candidate, rows: visibleRows });
    }
    return result;
  }, [feedback, profiles, showFlaggedOnly]);

  /* --- Website / app feedback --- */
  const [websiteRows, setWebsiteRows] = useState<WebsiteFeedbackRow[]>([]);
  const [websiteProfiles, setWebsiteProfiles] = useState<Record<string, ProfileSummary>>({});
  const [websiteLoading, setWebsiteLoading] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);

  const loadWebsite = useCallback(async () => {
    setWebsiteLoading(true);
    setWebsiteError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_website_feedback',
      })) as {
        website_feedback?: WebsiteFeedbackRow[];
        profiles?: Record<string, ProfileSummary>;
      };
      setWebsiteRows((res.website_feedback ?? []) as WebsiteFeedbackRow[]);
      setWebsiteProfiles(res.profiles ?? {});
    } catch (ex) {
      setWebsiteError(ex instanceof Error ? ex.message : 'Failed to load website feedback');
    } finally {
      setWebsiteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'website') return;
    void loadWebsite();
  }, [tab, loadWebsite]);

  return (
    <div>
      <h1 style={{ margin: '0 0 12px' }}>Feedback</h1>

      <div
        role="tablist"
        aria-label="Feedback type"
        style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'introductions'}
          className={`btn ${tab === 'introductions' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('introductions')}
        >
          Introduction feedback
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'website'}
          className={`btn ${tab === 'website' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('website')}
        >
          Website &amp; app
        </button>
      </div>

      {tab === 'introductions' ? (
        <div role="tabpanel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>After contact requests</h2>
            <button type="button" className="btn btn-secondary" onClick={() => void loadIntro()} disabled={introLoading}>
              {introLoading ? 'Loading…' : 'Refresh'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showFlaggedOnly}
                onChange={(e) => setShowFlaggedOnly(e.target.checked)}
              />
              Show only flagged / negative
            </label>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 720, margin: '0 0 16px' }}>
            Feedback is grouped by candidate (subject). Each row shows which member submitted it; candidates do not see
            these responses.
          </p>

          {introError && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{introError}</p>}

          {grouped.length === 0 && !introLoading && (
            <p style={{ color: '#6b7280' }}>No introduction feedback entries found.</p>
          )}

          {grouped.map(({ candidate, rows }) => (
            <div key={candidate.id} className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: '1rem' }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 6,
                  }}
                >
                  Candidate (feedback subject)
                </span>
                {candidate.first_name}
                {candidate.reference_number ? ` (${candidate.reference_number})` : ''}
                <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
                  {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                </span>
              </h3>

              <div className="table-scroll">
                <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ padding: '6px 8px' }}>Date</th>
                      <th style={{ padding: '6px 8px' }}>Feedback from</th>
                      <th style={{ padding: '6px 8px' }}>Made contact</th>
                      <th style={{ padding: '6px 8px' }}>Recommend retain</th>
                      <th style={{ padding: '6px 8px' }}>Notes</th>
                      <th style={{ padding: '6px 8px' }}>Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const highlight = row.is_flagged || row.recommend_retain === 'no';
                      const from = row.requester_id
                        ? profiles[row.requester_id] ?? {
                            id: row.requester_id,
                            first_name: row.requester_id,
                            reference_number: null,
                          }
                        : null;
                      const fromLabel = from
                        ? `${from.first_name}${from.reference_number ? ` (${from.reference_number})` : ''}`
                        : '—';
                      return (
                        <tr
                          key={row.id}
                          style={{
                            borderBottom: '1px solid var(--color-border)',
                            background: highlight ? '#fef3c7' : undefined,
                          }}
                        >
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {fmtDate(row.submitted_at)}
                          </td>
                          <td style={{ padding: '6px 8px' }}>{fromLabel}</td>
                          <td style={{ padding: '6px 8px' }}>{row.made_contact ?? '-'}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <span
                              style={{
                                color:
                                  row.recommend_retain === 'yes'
                                    ? 'var(--color-success)'
                                    : row.recommend_retain === 'no'
                                      ? 'var(--color-danger)'
                                      : undefined,
                                fontWeight: row.recommend_retain ? 600 : undefined,
                              }}
                            >
                              {row.recommend_retain ?? '-'}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: 300 }}>
                            {truncate(row.notes, 100)}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {row.is_flagged && <span className="badge badge-warning">Flagged</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div role="tabpanel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Website &amp; app suggestions</h2>
            <button type="button" className="btn btn-secondary" onClick={() => void loadWebsite()} disabled={websiteLoading}>
              {websiteLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 720, margin: '0 0 16px' }}>
            Optional feedback submitted from the <strong>Feedback</strong> link in the site header. Also emailed to{' '}
            <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a> when mail is configured.
          </p>

          {websiteError && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{websiteError}</p>}

          {websiteRows.length === 0 && !websiteLoading && (
            <p style={{ color: '#6b7280' }}>No website or app submissions yet.</p>
          )}

          {websiteRows.map((row) => {
            const prof =
              row.profile_id && websiteProfiles[row.profile_id]
                ? websiteProfiles[row.profile_id]
                : null;
            const who = prof
              ? `Member ${prof.first_name}${prof.reference_number ? ` (${prof.reference_number})` : ''}`
              : row.reporter_email?.trim()
                ? row.reporter_email
                : 'Anonymous visitor';
            return (
              <article key={row.id} className="card" style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <strong style={{ fontSize: 15 }}>{who}</strong>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {fmtDateTimeUtc(row.submitted_at)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
                  <code>{row.id}</code>
                  {prof && row.profile_id ? (
                    <span style={{ marginLeft: 8 }}>
                      Profile <code>{row.profile_id}</code>
                    </span>
                  ) : null}
                </div>
                {sectionBlock('How to improve the app', row.how_improve)}
                {sectionBlock('Things that are good', row.things_good)}
                {sectionBlock('Things that are bad', row.things_bad)}
                {sectionBlock('Suggestions for the future', row.suggestions_future)}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
