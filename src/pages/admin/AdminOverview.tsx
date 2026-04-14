import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

export default function AdminOverview() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState({
    pending: 0,
    requestsWeek: 0,
    expiring: 0,
    flagged: 0,
    lapsed90: 0,
  });
  const [actions, setActions] = useState<
    { id: string; action_type: string; created_at: string; notes: string | null }[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'overview_metrics' })) as {
        metrics?: typeof metrics;
        actions?: typeof actions;
      };
      if (res.metrics) setMetrics(res.metrics);
      setActions(res.actions ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load overview');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- metrics from Edge Function
    void loadOverview();
  }, [loadOverview]);

  return (
    <div>
      <h1>Overview</h1>
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
      <div className="admin-metric-grid" style={{ marginBottom: 32 }}>
        {(
          [
            ['Pending approvals', metrics.pending, '/admin/members', 'pending'],
            ['Requests this week', metrics.requestsWeek, '/admin/requests', null],
            ['Expiring (30d)', metrics.expiring, '/admin/members', 'active'],
            ['Flagged feedback', metrics.flagged, '/admin/feedback', null],
            ['Lapsed 90+ days', metrics.lapsed90, '/admin/members', 'lapsed90'],
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
            {a.notes && <p style={{ margin: '4px 0 0', fontSize: 14 }}>{a.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
