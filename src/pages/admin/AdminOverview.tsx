import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

type ReferralRow = {
  referred_profile_id: string;
  referred_first_name: string | null;
  referred_surname: string | null;
  referred_status: string;
  referred_reference_number: string | null;
  registered_at: string | null;
  code_used: string;
  referrer_profile_id: string | null;
  referrer_first_name: string | null;
  referrer_surname: string | null;
  referrer_reference_number: string | null;
  rewarded_at: string | null;
  referrer_months: number | null;
  referred_months: number | null;
};

type Metrics = {
  pending: number;
  requestsWeek: number;
  expiring: number;
  flagged: number;
  lapsed90: number;
  activeMembers: number;
  photoPendingReview: number;
  paidRegistrationSessions: number;
};

export default function AdminOverview() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics>({
    pending: 0,
    requestsWeek: 0,
    expiring: 0,
    flagged: 0,
    lapsed90: 0,
    activeMembers: 0,
    photoPendingReview: 0,
    paidRegistrationSessions: 0,
  });
  const [callerRole, setCallerRole] = useState<'super' | 'support' | null>(null);
  const [actions, setActions] = useState<
    {
      id: string;
      action_type: string;
      created_at: string;
      notes: string | null;
      admin_email?: string | null;
      target_profile_id?: string | null;
      target_profile?: { first_name: string; reference_number: string | null } | null;
    }[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [referralRows, setReferralRows] = useState<ReferralRow[]>([]);
  const [referralTotals, setReferralTotals] = useState<{ total: number; accepted: number; months_awarded: number }>({
    total: 0,
    accepted: 0,
    months_awarded: 0,
  });

  const loadOverview = useCallback(async () => {
    setLoadError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'overview_metrics' })) as {
        metrics?: Metrics;
        actions?: typeof actions;
        caller_role?: 'super' | 'support';
      };
      if (res.metrics) setMetrics(res.metrics);
      setActions(res.actions ?? []);
      setCallerRole(res.caller_role ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load overview');
    }
    try {
      const ref = (await invokeFunction('admin-manage-users', { action: 'list_referrals' })) as {
        rows?: ReferralRow[];
        totals?: { total: number; accepted: number; months_awarded: number };
      };
      setReferralRows(ref.rows ?? []);
      if (ref.totals) setReferralTotals(ref.totals);
    } catch {
      /* referral panel is non-critical; the rest of the overview still loads */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- metrics from Edge Function
    void loadOverview();
  }, [loadOverview]);

  const funnelPaid = metrics.paidRegistrationSessions;
  const funnelPending = metrics.pending;
  const funnelActive = metrics.activeMembers;

  return (
    <div>
      <h1>Overview</h1>
      {callerRole === 'support' && (
        <p className="card" style={{ marginBottom: 16, padding: 12, background: '#f6f4e8' }}>
          You are signed in with the <strong>support</strong> admin role: you can browse, resend emails, and edit
          internal notes, but approving members, editing full records, coupons, and high‑risk account actions require
          a <strong>super</strong> admin.
        </p>
      )}
      {loadError && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 16, padding: 12 }}>
          {loadError}
        </p>
      )}
      <p className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
        Counts use the admin service (not limited by row-level security in your browser). If loading fails,
        redeploy the <code style={{ fontSize: 13 }}>admin-manage-users</code> Edge Function and confirm your
        session is from the same Supabase project as the app.
      </p>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Registration funnel (approximate)</h2>
        <p className="field-hint" style={{ marginTop: -6 }}>
          <strong>Paid registration checkouts</strong> counts Stripe rows with purpose registration and status paid
          (may include duplicates if someone paid twice). <strong>Pending</strong> and <strong>Active</strong> are live
          profile counts.
        </p>
        <div className="admin-funnel-row">
          <div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Paid checkouts</p>
            <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700 }}>{funnelPaid}</p>
          </div>
          <span className="admin-funnel-arrow" aria-hidden>
            →
          </span>
          <button
            type="button"
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer', padding: '12px 16px' }}
            onClick={() => navigate('/admin/members?filter=pending')}
          >
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Pending approval</p>
            <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700 }}>{funnelPending}</p>
          </button>
          <span className="admin-funnel-arrow" aria-hidden>
            →
          </span>
          <button
            type="button"
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer', padding: '12px 16px' }}
            onClick={() => navigate('/admin/members?filter=active')}
          >
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Active members</p>
            <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700 }}>{funnelActive}</p>
          </button>
        </div>
        <p style={{ marginTop: 16, marginBottom: 0, fontSize: 14 }}>
          <strong>Photo pending review (any status):</strong> {metrics.photoPendingReview}{' '}
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={() => navigate('/admin/members?filter=photo_pending')}>
            View list
          </button>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Referral scheme</h2>
        <p className="field-hint" style={{ marginTop: -6 }}>
          Members who registered using another member&apos;s recommend-a-friend code. Rewards (2 months to the
          referrer, 1 to the new member) are applied automatically at approval.
        </p>
        <p style={{ fontSize: 14, margin: '0 0 12px' }}>
          <strong>{referralTotals.total}</strong> registered via referral · <strong>{referralTotals.accepted}</strong>{' '}
          accepted · <strong>{referralTotals.months_awarded}</strong> free months given out
        </p>
        {referralRows.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 14 }}>
            No referral registrations yet.
          </p>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)' }}>
                  <th style={{ padding: '6px 8px' }}>New member</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Registered</th>
                  <th style={{ padding: '6px 8px' }}>Referred by</th>
                  <th style={{ padding: '6px 8px' }}>Code</th>
                  <th style={{ padding: '6px 8px' }}>Reward</th>
                </tr>
              </thead>
              <tbody>
                {referralRows.map((r) => (
                  <tr key={r.referred_profile_id} style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <button
                        type="button"
                        className="btn-link"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-primary)', textDecoration: 'underline', fontSize: 14 }}
                        onClick={() => navigate(`/admin/members/${r.referred_profile_id}`)}
                      >
                        {[r.referred_first_name, r.referred_surname].filter(Boolean).join(' ') || 'Unknown'}
                      </button>{' '}
                      {r.referred_reference_number ? `(${r.referred_reference_number})` : ''}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{r.referred_status}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.registered_at ? new Date(r.registered_at).toLocaleDateString('en-GB') : '-'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.referrer_profile_id ? (
                        <button
                          type="button"
                          className="btn-link"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-primary)', textDecoration: 'underline', fontSize: 14 }}
                          onClick={() => navigate(`/admin/members/${r.referrer_profile_id}`)}
                        >
                          {[r.referrer_first_name, r.referrer_surname].filter(Boolean).join(' ') || 'Unknown'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--color-text-secondary)' }}>code no longer matches a member</span>
                      )}
                      {r.referrer_reference_number ? ` (${r.referrer_reference_number})` : ''}
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.code_used}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.rewarded_at
                        ? `+${r.referrer_months ?? 0}m referrer / +${r.referred_months ?? 0}m member`
                        : r.referred_months != null
                          ? `+${r.referred_months}m member only`
                          : 'awaiting approval'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="admin-metric-grid" style={{ marginBottom: 32 }}>
        {(
          [
            ['Pending approvals', metrics.pending, '/admin/members', 'pending'],
            ['Requests this week', metrics.requestsWeek, '/admin/requests', null],
            ['Expiring (30d)', metrics.expiring, '/admin/members', 'active'],
            ['Flagged feedback', metrics.flagged, '/admin/feedback', null],
            ['Long-lapsed (365+ days)', metrics.lapsed90, '/admin/members', 'lapsed90'],
          ] as const
        ).map(([label, n, path, filter]) => (
          <button
            key={label}
            type="button"
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => {
              navigate(path + (filter ? `?filter=${encodeURIComponent(filter)}` : ''));
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>{label}</p>
            <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 600 }}>{n}</p>
          </button>
        ))}
      </div>
      <h2>Recent activity</h2>
      <p className="field-hint" style={{ marginTop: -8, marginBottom: 12 }}>
        Logged when you approve, reject, or take other admin actions (via the dashboard functions). It does
        not list member self‑service events.
      </p>
      {actions.length === 0 && !loadError && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No admin actions recorded yet.</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {actions.map((a) => (
          <li key={a.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
            <strong>{a.action_type}</strong>{' '}
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
              {new Date(a.created_at).toLocaleString('en-GB')}
            </span>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              By: {a.admin_email ?? 'Unknown admin'}
              {a.target_profile ? (
                <>
                  {' '}| Member: {a.target_profile.first_name} ({a.target_profile.reference_number ?? '-'})
                </>
              ) : a.target_profile_id ? (
                <> | Member ID: {a.target_profile_id}</>
              ) : (
                ''
              )}
            </p>
            {a.notes && <p style={{ margin: '4px 0 0', fontSize: 14 }}>{a.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
