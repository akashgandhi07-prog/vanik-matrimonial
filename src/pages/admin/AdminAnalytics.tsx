import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

type WeekPoint = { week_start: string; count: number };

type TopRequestedRow = {
  profile_id: string;
  label: string;
  status: string;
  hidden_reason: string | null;
  count: number;
};

type ZeroRequestedRow = {
  profile_id: string;
  label: string;
  gender: string | null;
  listed_since: string;
};

type TopReferrerRow = {
  profile_id: string;
  label: string;
  referrals: number;
  rewarded: number;
  months_earned: number;
};

type AgeBandRow = { band: string; Male: number; Female: number; total: number };

type PauseStats = {
  total: number;
  byReason: Record<string, number>;
  recent_notes: { label: string; reason: string; note: string; created_at: string }[];
};

type AnalyticsStats = {
  members: {
    total: number;
    byStatus: Record<string, number>;
    byHiddenReason: Record<string, number>;
    byGender: Record<string, number>;
    activeByGender: Record<string, number>;
    ageBands?: AgeBandRow[];
    ageUnknown?: number;
  };
  pauses?: PauseStats;
  expiring: { in30: number; in60: number };
  registrationsByWeek: WeekPoint[];
  requestsByWeek: WeekPoint[];
  requests: {
    total: number;
    candidate_mentions: number;
    top_requested: TopRequestedRow[];
    zero_requested: ZeroRequestedRow[];
    zero_requested_total: number;
  };
  referrals: {
    total: number;
    rewarded: number;
    months_awarded: number;
    top_referrers: TopReferrerRow[];
  };
  feedback: {
    total: number;
    recommend_yes: number;
    recommend_no: number;
    recommend_unsure: number;
    flagged_open: number;
    archived: number;
  };
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending_approval: 'Pending approval',
  expired: 'Expired',
  rejected: 'Rejected',
  closed: 'Closed',
};

const HIDDEN_REASON_LABELS: Record<string, string> = {
  member_paused: 'Paused by member',
  matched: 'Matched',
  admin: 'Hidden by admin',
};

const PAUSE_REASON_LABELS: Record<string, string> = {
  found_here: 'Found someone through this register',
  found_elsewhere: 'Found someone elsewhere',
  taking_break: 'Taking a break',
  other: 'Another reason',
  prefer_not_say: 'Preferred not to say',
};

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function statusLabel(row: { status: string; hidden_reason: string | null }): string {
  const base = STATUS_LABELS[row.status] ?? row.status;
  if (row.hidden_reason) {
    return `${base} · ${HIDDEN_REASON_LABELS[row.hidden_reason] ?? row.hidden_reason}`;
  }
  return base;
}

function WeekBarChart({ data, caption }: { data: WeekPoint[]; caption: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, marginTop: 8 }}
        role="img"
        aria-label={caption}
      >
        {data.map((d) => (
          <div
            key={d.week_start}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 4,
              height: '100%',
            }}
            title={`Week of ${weekLabel(d.week_start)}: ${d.count}`}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>{d.count}</span>
            <div
              style={{
                width: '100%',
                maxWidth: 26,
                height: `${Math.max(3, Math.round((d.count / max) * 100))}px`,
                background: d.count > 0 ? 'var(--color-primary)' : 'rgba(0,0,0,0.12)',
                borderRadius: '3px 3px 0 0',
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {weekLabel(d.week_start)}
            </span>
          </div>
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: 6, marginBottom: 0 }}>
        {caption} Weeks start on Monday (UTC).
      </p>
    </div>
  );
}

const thStyle = { padding: '6px 8px' } as const;
const tdStyle = { padding: '6px 8px' } as const;
const rowBorder = { borderBottom: '1px solid rgba(0,0,0,0.07)' } as const;
const memberLinkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--color-primary)',
  textDecoration: 'underline',
  fontSize: 14,
} as const;

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'analytics_stats' })) as AnalyticsStats;
      if (!res || !res.members || !Array.isArray(res.registrationsByWeek)) {
        throw new Error('Incomplete analytics from server');
      }
      setStats(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load analytics');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div>
      <h1>Analytics</h1>
      <p className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
        A statistics dashboard for the register. Counts use the admin service (not limited by row-level
        security in your browser); refresh the page for the latest numbers.
      </p>
      {loadError && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 16, padding: 12 }}>
          {loadError}{' '}
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {loading && <p style={{ color: 'var(--color-text-secondary)' }}>Loading analytics…</p>}
      {!loading && stats && (
        <>
          <h2 style={{ marginTop: 0 }}>Members by state</h2>
          <div className="admin-metric-grid" style={{ marginBottom: 16 }}>
            {(
              [
                ['Active', stats.members.byStatus.active ?? 0, 'active'],
                ['Pending approval', stats.members.byStatus.pending_approval ?? 0, 'pending'],
                ['Paused by member', stats.members.byHiddenReason.member_paused ?? 0, 'paused'],
                ['Matched', stats.members.byHiddenReason.matched ?? 0, 'matched'],
                ['Expired', stats.members.byStatus.expired ?? 0, 'expired'],
                ['Rejected', stats.members.byStatus.rejected ?? 0, 'rejected'],
                ['Closed', stats.members.byStatus.closed ?? 0, 'closed'],
                ['Hidden by admin', stats.members.byHiddenReason.admin ?? 0, 'hidden'],
              ] as const
            ).map(([label, n, filter]) => (
              <button
                key={label}
                type="button"
                className="card"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate(`/admin/members?filter=${encodeURIComponent(filter)}`)}
              >
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>{label}</p>
                <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 600 }}>{n}</p>
              </button>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 24 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{stats.members.total}</strong> profiles in total ·{' '}
              <strong>{stats.members.byGender.Male ?? 0}</strong> male /{' '}
              <strong>{stats.members.byGender.Female ?? 0}</strong> female overall · among active members:{' '}
              <strong>{stats.members.activeByGender.Male ?? 0}</strong> male /{' '}
              <strong>{stats.members.activeByGender.Female ?? 0}</strong> female
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>
              Memberships expiring: <strong>{stats.expiring.in30}</strong> within 30 days ·{' '}
              <strong>{stats.expiring.in60}</strong> within 60 days ·{' '}
              <strong>{stats.members.byStatus.pending_approval ?? 0}</strong> approvals outstanding
            </p>
          </div>

          {stats.members.ageBands && stats.members.ageBands.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ marginTop: 0 }}>Age profile of active members</h2>
              <div className="table-scroll">
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)' }}>
                      <th style={thStyle}>Age band</th>
                      <th style={thStyle}>Male</th>
                      <th style={thStyle}>Female</th>
                      <th style={thStyle}>Total</th>
                      <th style={{ ...thStyle, width: '40%' }} aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const maxTotal = Math.max(1, ...stats.members.ageBands.map((b) => b.total));
                      return stats.members.ageBands.map((b) => (
                        <tr key={b.band} style={rowBorder}>
                          <td style={tdStyle}>
                            <strong>{b.band}</strong>
                          </td>
                          <td style={tdStyle}>{b.Male}</td>
                          <td style={tdStyle}>{b.Female}</td>
                          <td style={tdStyle}>
                            <strong>{b.total}</strong>
                          </td>
                          <td style={tdStyle}>
                            <div
                              style={{
                                height: 10,
                                width: `${Math.round((b.total / maxTotal) * 100)}%`,
                                minWidth: b.total > 0 ? 6 : 0,
                                background: 'var(--color-primary)',
                                borderRadius: 5,
                              }}
                            />
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
              {(stats.members.ageUnknown ?? 0) > 0 && (
                <p className="field-hint" style={{ marginBottom: 0 }}>
                  {stats.members.ageUnknown} active member{stats.members.ageUnknown === 1 ? '' : 's'} without a
                  recorded age.
                </p>
              )}
            </div>
          )}

          {stats.pauses && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ marginTop: 0 }}>Why members pause</h2>
              <p className="field-hint" style={{ marginTop: -6 }}>
                Self-reported when a member pauses their profile. "Found someone through this register" is the
                success signal to watch.
              </p>
              {stats.pauses.total === 0 ? (
                <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 14 }}>
                  No pause reasons recorded yet (collected from now on whenever a member pauses).
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 14, margin: '0 0 8px' }}>
                    {Object.entries(stats.pauses.byReason)
                      .filter(([, n]) => n > 0)
                      .map(([reason, n], i, arr) => (
                        <span key={reason}>
                          <strong style={reason === 'found_here' ? { color: 'var(--color-success)' } : undefined}>
                            {n}
                          </strong>{' '}
                          {PAUSE_REASON_LABELS[reason] ?? reason}
                          {i < arr.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                  </p>
                  {stats.pauses.recent_notes.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                      {stats.pauses.recent_notes.map((n, i) => (
                        <li key={`${n.created_at}-${i}`} style={{ marginBottom: 4 }}>
                          {new Date(n.created_at).toLocaleDateString('en-GB')} · {n.label} (
                          {PAUSE_REASON_LABELS[n.reason] ?? n.reason}): "{n.note}"
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Registrations per week</h2>
            <WeekBarChart
              data={stats.registrationsByWeek}
              caption="New profiles created in each of the last 12 weeks."
            />
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Contact requests per week</h2>
            <WeekBarChart data={stats.requestsByWeek} caption="Contact requests submitted in each of the last 12 weeks." />
            <p style={{ margin: '10px 0 0', fontSize: 14 }}>
              <strong>{stats.requests.total}</strong> requests all-time, covering{' '}
              <strong>{stats.requests.candidate_mentions}</strong> member selections.
            </p>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Most requested members</h2>
            <p className="field-hint" style={{ marginTop: -6 }}>
              How often each member has appeared in contact requests, all-time (top 10).
            </p>
            {stats.requests.top_requested.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 14 }}>No contact requests yet.</p>
            ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)' }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Member</th>
                      <th style={thStyle}>State</th>
                      <th style={thStyle}>Times requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.requests.top_requested.map((r, i) => (
                      <tr key={r.profile_id} style={rowBorder}>
                        <td style={tdStyle}>{i + 1}</td>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            style={memberLinkStyle}
                            onClick={() => navigate(`/admin/members/${r.profile_id}`)}
                          >
                            {r.label}
                          </button>
                        </td>
                        <td style={tdStyle}>{statusLabel(r)}</td>
                        <td style={tdStyle}>
                          <strong>{r.count}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Active members never requested</h2>
            <p className="field-hint" style={{ marginTop: -6 }}>
              Active, listed members who have not appeared in any contact request yet — worth a look at their
              profiles or photos. {stats.requests.zero_requested_total} in total
              {stats.requests.zero_requested_total > stats.requests.zero_requested.length
                ? `, showing the ${stats.requests.zero_requested.length} longest-listed`
                : ''}
              .
            </p>
            {stats.requests.zero_requested.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 14 }}>
                Every active listed member has been requested at least once.
              </p>
            ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)' }}>
                      <th style={thStyle}>Member</th>
                      <th style={thStyle}>Gender</th>
                      <th style={thStyle}>Listed since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.requests.zero_requested.map((r) => (
                      <tr key={r.profile_id} style={rowBorder}>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            style={memberLinkStyle}
                            onClick={() => navigate(`/admin/members/${r.profile_id}`)}
                          >
                            {r.label}
                          </button>
                        </td>
                        <td style={tdStyle}>{r.gender ?? '-'}</td>
                        <td style={tdStyle}>{new Date(r.listed_since).toLocaleDateString('en-GB')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Referral scheme</h2>
            <p style={{ fontSize: 14, margin: '0 0 12px' }}>
              <strong>{stats.referrals.total}</strong> referrals recorded · <strong>{stats.referrals.rewarded}</strong>{' '}
              rewarded · <strong>{stats.referrals.months_awarded}</strong> free months given out
            </p>
            {stats.referrals.top_referrers.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 14 }}>No referrals yet.</p>
            ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)' }}>
                      <th style={thStyle}>Referrer</th>
                      <th style={thStyle}>Referrals</th>
                      <th style={thStyle}>Rewarded</th>
                      <th style={thStyle}>Months earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.referrals.top_referrers.map((r) => (
                      <tr key={r.profile_id} style={rowBorder}>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            style={memberLinkStyle}
                            onClick={() => navigate(`/admin/members/${r.profile_id}`)}
                          >
                            {r.label}
                          </button>
                        </td>
                        <td style={tdStyle}>{r.referrals}</td>
                        <td style={tdStyle}>{r.rewarded}</td>
                        <td style={tdStyle}>{r.months_earned}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginTop: 0 }}>Introduction feedback</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              <strong>{stats.feedback.total}</strong> feedback submissions all-time ·{' '}
              <strong>{stats.feedback.recommend_yes}</strong> recommend retaining ·{' '}
              <strong>{stats.feedback.recommend_no}</strong> do not · <strong>{stats.feedback.recommend_unsure}</strong>{' '}
              unsure
            </p>
            <p style={{ fontSize: 14, margin: '8px 0 0' }}>
              <strong style={{ color: stats.feedback.flagged_open > 0 ? 'var(--color-danger)' : undefined }}>
                {stats.feedback.flagged_open}
              </strong>{' '}
              flagged and awaiting review · {stats.feedback.archived} archived{' '}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: 8 }}
                onClick={() => navigate('/admin/feedback')}
              >
                Open feedback
              </button>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
