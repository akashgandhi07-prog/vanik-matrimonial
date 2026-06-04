import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

type FeedbackRow = {
  id: string;
  request_id: string;
  candidate_id: string | null;
  requester_id: string | null;
  candidate_display_name: string | null;
  requester_display_name: string | null;
  made_contact: string | null;
  recommend_retain: string | null;
  notes: string | null;
  is_flagged: boolean;
  archived_at: string | null;
  /** DB column is `submitted_at` (not `created_at`). */
  submitted_at: string;
};

type RequestSummary = {
  requester_id: string | null;
  candidate_ids: string[] | null;
};

type ProfileSummary = {
  id: string;
  first_name: string;
  reference_number: string | null;
  full_name?: string;
};

type GroupedFeedback = {
  candidate: ProfileSummary;
  rows: FeedbackRow[];
  profileId: string | null;
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
  archived_at: string | null;
};

type FeedbackKind = 'introduction' | 'website';

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

function resolveCandidateId(row: FeedbackRow, requests: Record<string, RequestSummary>): string | null {
  if (row.candidate_id) return row.candidate_id;
  const req = row.request_id ? requests[row.request_id] : undefined;
  const ids = req?.candidate_ids ?? [];
  return ids.length === 1 ? ids[0] : null;
}

function resolveRequesterId(row: FeedbackRow, requests: Record<string, RequestSummary>): string | null {
  if (row.requester_id) return row.requester_id;
  const req = row.request_id ? requests[row.request_id] : undefined;
  return req?.requester_id ?? null;
}

function memberLabel(
  profileId: string | null,
  displayName: string | null | undefined,
  profiles: Record<string, ProfileSummary>
): { label: string; profileId: string | null } {
  if (profileId && profiles[profileId]) {
    const p = profiles[profileId];
    const label =
      p.full_name?.trim() ||
      `${p.first_name}${p.reference_number ? ` (${p.reference_number})` : ''}`.trim();
    if (label) return { label, profileId };
  }
  const snap = displayName?.trim();
  if (snap) return { label: snap, profileId };
  return { label: 'Unknown member', profileId: null };
}

function MemberProfileLink({
  profileId,
  label,
}: {
  profileId: string | null;
  label: string;
}) {
  if (profileId) {
    return (
      <Link to={`/admin/members/${profileId}`} style={{ fontWeight: 600 }}>
        {label}
      </Link>
    );
  }
  return <span style={{ fontWeight: 600 }}>{label}</span>;
}

function FeedbackRowActions({
  rowId,
  archived,
  busy,
  onOp,
}: {
  rowId: string;
  archived: boolean;
  busy: boolean;
  onOp: (op: 'archive' | 'delete' | 'restore', ids: string[]) => void;
}) {
  const btnStyle = { padding: '2px 8px', fontSize: 12, marginRight: 6 };
  if (archived) {
    return (
      <div style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={btnStyle}
          disabled={busy}
          onClick={() => onOp('restore', [rowId])}
        >
          Restore
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={btnStyle}
          disabled={busy}
          onClick={() => onOp('delete', [rowId])}
        >
          Delete
        </button>
      </div>
    );
  }
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={btnStyle}
        disabled={busy}
        onClick={() => onOp('archive', [rowId])}
      >
        Archive
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        style={btnStyle}
        disabled={busy}
        onClick={() => onOp('delete', [rowId])}
      >
        Delete
      </button>
    </div>
  );
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
        {text?.trim() ? text : '-'}
      </div>
    </div>
  );
}

export default function AdminFeedback() {
  const [tab, setTab] = useState<'introductions' | 'website'>('introductions');

  /* --- Introduction feedback --- */
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [requests, setRequests] = useState<Record<string, RequestSummary>>({});
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [manageBusy, setManageBusy] = useState(false);
  const [introLoading, setIntroLoading] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);
  const [websiteRows, setWebsiteRows] = useState<WebsiteFeedbackRow[]>([]);
  const [websiteProfiles, setWebsiteProfiles] = useState<Record<string, ProfileSummary>>({});
  const [websiteLoading, setWebsiteLoading] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [showWebsiteArchived, setShowWebsiteArchived] = useState(false);

  const loadIntro = useCallback(async () => {
    setIntroLoading(true);
    setIntroError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_feedback',
        include_archived: showArchived,
      })) as {
        feedback?: FeedbackRow[];
        profiles?: Record<string, ProfileSummary>;
        requests?: Record<string, RequestSummary>;
      };
      setFeedback((res.feedback ?? []) as FeedbackRow[]);
      setProfiles(res.profiles ?? {});
      setRequests(res.requests ?? {});
    } catch (ex) {
      setIntroError(ex instanceof Error ? ex.message : 'Failed to load feedback');
    } finally {
      setIntroLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void loadIntro();
  }, [loadIntro]);

  const loadWebsite = useCallback(async () => {
    setWebsiteLoading(true);
    setWebsiteError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_website_feedback',
        include_archived: showWebsiteArchived,
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
  }, [showWebsiteArchived]);

  useEffect(() => {
    if (tab !== 'website') return;
    void loadWebsite();
  }, [tab, loadWebsite]);

  const selectedIdList = useMemo(
    () => Object.keys(selectedIds).filter((id) => selectedIds[id]),
    [selectedIds]
  );
  const selectedCount = selectedIdList.length;

  const runFeedbackOp = useCallback(
    async (op: 'archive' | 'delete' | 'restore', ids: string[], kind: FeedbackKind) => {
      if (ids.length === 0) return;
      if (
        op === 'delete' &&
        !window.confirm(
          `Permanently delete ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`
        )
      ) {
        return;
      }
      setManageBusy(true);
      setIntroError(null);
      setWebsiteError(null);
      try {
        await invokeFunction('admin-manage-users', {
          action: 'manage_feedback',
          kind,
          op,
          ids,
        });
        setSelectedIds({});
        if (kind === 'introduction') await loadIntro();
        else await loadWebsite();
      } catch (ex) {
        const msg = ex instanceof Error ? ex.message : 'Action failed';
        if (kind === 'introduction') setIntroError(msg);
        else setWebsiteError(msg);
      } finally {
        setManageBusy(false);
      }
    },
    [loadIntro, loadWebsite]
  );

  const grouped = useMemo<GroupedFeedback[]>(() => {
    const map = new Map<string, FeedbackRow[]>();
    for (const row of feedback) {
      const resolvedId = resolveCandidateId(row, requests);
      const groupKey =
        resolvedId ??
        (row.candidate_display_name?.trim()
          ? `name:${row.candidate_display_name.trim()}`
          : '__unknown__');
      const list = map.get(groupKey) ?? [];
      list.push(row);
      map.set(groupKey, list);
    }

    const result: GroupedFeedback[] = [];
    for (const [groupKey, rows] of map.entries()) {
      const visibleRows = showFlaggedOnly
        ? rows.filter((r) => r.is_flagged || r.recommend_retain === 'no')
        : rows;
      if (visibleRows.length === 0) continue;
      const sample = visibleRows[0];
      const resolvedId = resolveCandidateId(sample, requests);
      const { label, profileId } = memberLabel(
        resolvedId,
        sample.candidate_display_name,
        profiles
      );
      const candidate: ProfileSummary = profileId
        ? (profiles[profileId] ?? {
            id: profileId,
            first_name: label,
            reference_number: null,
            full_name: label,
          })
        : {
            id: groupKey,
            first_name: label,
            reference_number: null,
            full_name: label,
          };
      result.push({ candidate, rows: visibleRows, profileId });
    }
    return result.sort((a, b) => a.candidate.first_name.localeCompare(b.candidate.first_name));
  }, [feedback, profiles, requests, showFlaggedOnly]);

  useEffect(() => {
    setSelectedIds({});
  }, [tab, showArchived, showWebsiteArchived]);

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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
          {selectedCount > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 12,
                padding: '10px 12px',
                background: 'var(--color-surface-muted)',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedCount} selected</span>
              {!showArchived && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={manageBusy}
                  onClick={() => void runFeedbackOp('archive', selectedIdList, 'introduction')}
                >
                  Archive selected
                </button>
              )}
              {showArchived && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={manageBusy}
                  onClick={() => void runFeedbackOp('restore', selectedIdList, 'introduction')}
                >
                  Restore selected
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={manageBusy}
                onClick={() => void runFeedbackOp('delete', selectedIdList, 'introduction')}
              >
                Delete selected
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={manageBusy}
                onClick={() => setSelectedIds({})}
              >
                Clear selection
              </button>
            </div>
          )}
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 720, margin: '0 0 16px' }}>
            Feedback is grouped by candidate (subject). Each row shows which member submitted it; candidates do not see
            these responses.
          </p>

          {introError && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{introError}</p>}

          {grouped.length === 0 && !introLoading && (
            <p style={{ color: '#6b7280' }}>No introduction feedback entries found.</p>
          )}

          {grouped.map(({ candidate, rows, profileId }) => {
            const candidateLabel =
              candidate.full_name?.trim() ||
              `${candidate.first_name}${candidate.reference_number ? ` (${candidate.reference_number})` : ''}`.trim();
            return (
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
                <MemberProfileLink profileId={profileId} label={candidateLabel || 'Unknown candidate'} />
                <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
                  {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                </span>
                {!profileId && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 6,
                      fontSize: 12,
                      fontWeight: 400,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Profile removed; name kept for audit only.
                  </span>
                )}
              </h3>

              <div className="table-scroll">
                <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ padding: '6px 8px', width: 40 }}>Select</th>
                      <th style={{ padding: '6px 8px' }}>Date</th>
                      <th style={{ padding: '6px 8px' }}>Feedback from</th>
                      <th style={{ padding: '6px 8px' }}>Made contact</th>
                      <th style={{ padding: '6px 8px' }}>Recommend retain</th>
                      <th style={{ padding: '6px 8px' }}>Notes</th>
                      <th style={{ padding: '6px 8px' }}>Flagged</th>
                      <th style={{ padding: '6px 8px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const highlight = row.is_flagged || row.recommend_retain === 'no';
                      const requesterProfileId = resolveRequesterId(row, requests);
                      const { label: fromLabel, profileId: fromProfileId } = memberLabel(
                        requesterProfileId,
                        row.requester_display_name,
                        profiles
                      );
                      const isArchived = !!row.archived_at;
                      return (
                        <tr
                          key={row.id}
                          style={{
                            borderBottom: '1px solid var(--color-border)',
                            background: highlight ? '#fef3c7' : isArchived ? '#f8fafc' : undefined,
                            opacity: isArchived ? 0.85 : undefined,
                          }}
                        >
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="checkbox"
                              aria-label={`Select feedback ${fmtDate(row.submitted_at)}`}
                              checked={!!selectedIds[row.id]}
                              onChange={(e) =>
                                setSelectedIds((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.checked,
                                }))
                              }
                            />
                          </td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {fmtDate(row.submitted_at)}
                            {isArchived && (
                              <span
                                className="badge badge-muted"
                                style={{ marginLeft: 6, fontSize: 11 }}
                              >
                                Archived
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <MemberProfileLink profileId={fromProfileId} label={fromLabel} />
                          </td>
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
                          <td style={{ padding: '6px 8px' }}>
                            <FeedbackRowActions
                              rowId={row.id}
                              archived={isArchived}
                              busy={manageBusy}
                              onOp={(op, ids) => void runFeedbackOp(op, ids, 'introduction')}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
          })}
        </div>
      ) : (
        <div role="tabpanel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Website &amp; app suggestions</h2>
            <button type="button" className="btn btn-secondary" onClick={() => void loadWebsite()} disabled={websiteLoading}>
              {websiteLoading ? 'Loading…' : 'Refresh'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showWebsiteArchived}
                onChange={(e) => setShowWebsiteArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
          {tab === 'website' && selectedCount > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 12,
                padding: '10px 12px',
                background: 'var(--color-surface-muted)',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedCount} selected</span>
              {!showWebsiteArchived && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={manageBusy}
                  onClick={() => void runFeedbackOp('archive', selectedIdList, 'website')}
                >
                  Archive selected
                </button>
              )}
              {showWebsiteArchived && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={manageBusy}
                  onClick={() => void runFeedbackOp('restore', selectedIdList, 'website')}
                >
                  Restore selected
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={manageBusy}
                onClick={() => void runFeedbackOp('delete', selectedIdList, 'website')}
              >
                Delete selected
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={manageBusy}
                onClick={() => setSelectedIds({})}
              >
                Clear selection
              </button>
            </div>
          )}
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 720, margin: '0 0 16px' }}>
            Optional feedback submitted from the <strong>Feedback</strong> link in the site header. Also emailed to{' '}
            <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a> and{' '}
            <a href="mailto:vanikcouncil1@gmail.com">vanikcouncil1@gmail.com</a> when mail is configured.
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
            const isArchived = !!row.archived_at;
            return (
              <article
                key={row.id}
                className="card"
                style={{ marginBottom: 18, opacity: isArchived ? 0.9 : undefined }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!selectedIds[row.id]}
                      onChange={(e) =>
                        setSelectedIds((prev) => ({
                          ...prev,
                          [row.id]: e.target.checked,
                        }))
                      }
                    />
                    <strong style={{ fontSize: 15 }}>{who}</strong>
                  </label>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {fmtDateTimeUtc(row.submitted_at)}
                    {isArchived ? ' · Archived' : ''}
                  </span>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <FeedbackRowActions
                    rowId={row.id}
                    archived={isArchived}
                    busy={manageBusy}
                    onOp={(op, ids) => void runFeedbackOp(op, ids, 'website')}
                  />
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
