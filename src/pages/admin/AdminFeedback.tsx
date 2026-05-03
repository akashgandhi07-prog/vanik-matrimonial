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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function truncate(s: string | null, len: number): string {
  if (!s) return '-';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

export default function AdminFeedback() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'list_feedback' })) as {
        feedback?: FeedbackRow[];
        profiles?: Record<string, ProfileSummary>;
      };
      setFeedback((res.feedback ?? []) as FeedbackRow[]);
      setProfiles(res.profiles ?? {});
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from Edge Function
    void load();
  }, [load]);

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Feedback</h1>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
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
        Feedback is grouped by candidate (subject). Each row shows which member submitted it; candidates do not
        see these responses.
      </p>

      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>}

      {grouped.length === 0 && !loading && (
        <p style={{ color: '#6b7280' }}>No feedback entries found.</p>
      )}

      {grouped.map(({ candidate, rows }) => (
        <div key={candidate.id} className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
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
          </h2>

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
                        {row.is_flagged && (
                          <span className="badge badge-warning">Flagged</span>
                        )}
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
  );
}
