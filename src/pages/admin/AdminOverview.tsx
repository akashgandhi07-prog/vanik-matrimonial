import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

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

  const loadOverview = useCallback(async () => {
    const { count: pending } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval');
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count: requestsWeek } = await supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgo);
    const monthEnd = new Date();
    monthEnd.setDate(monthEnd.getDate() + 30);
    const { count: expiring } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .lte('membership_expires_at', monthEnd.toISOString())
      .gte('membership_expires_at', new Date().toISOString());
    const { count: flagged } = await supabase
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('is_flagged', true);
    const lapseCutoff = new Date(Date.now() - 90 * 864e5).toISOString();
    const { count: lapsed90 } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'expired')
      .lt('membership_expires_at', lapseCutoff);
    setMetrics({
      pending: pending ?? 0,
      requestsWeek: requestsWeek ?? 0,
      expiring: expiring ?? 0,
      flagged: flagged ?? 0,
      lapsed90: lapsed90 ?? 0,
    });
    const { data: act } = await supabase
      .from('admin_actions')
      .select('id, action_type, created_at, notes')
      .order('created_at', { ascending: false })
      .limit(20);
    setActions(act ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- metrics from Supabase
    void loadOverview();
  }, [loadOverview]);

  return (
    <div>
      <h1>Overview</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
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
