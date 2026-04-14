import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '../../lib/supabase';

type AuthRow = { id: string; email: string | undefined; is_admin: boolean; created_at: string };

export default function AdminSettings() {
  const [users, setUsers] = useState<AuthRow[]>([]);
  const [stats, setStats] = useState<{
    byStatus: Record<string, number>;
    requests: number;
    feedback: number;
    emailAttempted: number;
    emailOk: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [listRes, statsRes] = await Promise.all([
        invokeFunction('admin-manage-users', { action: 'list' }) as Promise<{ users?: AuthRow[] }>,
        invokeFunction('admin-manage-users', { action: 'settings_stats' }) as Promise<{
          byStatus?: Record<string, number>;
          requests?: number;
          feedback?: number;
          emailAttempted?: number;
          emailOk?: number;
        }>,
      ]);
      setUsers(listRes.users ?? []);
      if (
        statsRes.byStatus != null &&
        statsRes.requests !== undefined &&
        statsRes.feedback !== undefined &&
        statsRes.emailAttempted !== undefined &&
        statsRes.emailOk !== undefined
      ) {
        setStats({
          byStatus: statsRes.byStatus,
          requests: statsRes.requests,
          feedback: statsRes.feedback,
          emailAttempted: statsRes.emailAttempted,
          emailOk: statsRes.emailOk,
        });
      } else {
        setStats(null);
        setLoadError('Incomplete stats from server');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load settings');
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

  async function promote(id: string) {
    try {
      await invokeFunction('admin-manage-users', { action: 'promote', user_id: id });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function demote(id: string) {
    if (!confirm('Remove admin access for this user?')) return;
    try {
      await invokeFunction('admin-manage-users', { action: 'demote', user_id: id });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    }
  }

  const rate =
    stats && stats.emailAttempted > 0
      ? Math.round((stats.emailOk / stats.emailAttempted) * 1000) / 10
      : null;

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: 'var(--color-text-secondary)', maxWidth: 720 }}>
        Promote or demote administrators. Demotion is blocked if this would remove the last admin. See{' '}
        <code style={{ fontSize: 13 }}>docs/SETUP.md</code> for creating the first and second admin accounts.
      </p>

      {loadError && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 16, padding: 12 }}>
          {loadError}
        </p>
      )}

      {loading && <p>Loading…</p>}

      {stats && (
        <div className="card table-scroll" style={{ marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>System stats</h2>
          <h3 style={{ fontSize: 15 }}>Members by status</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {Object.entries(stats.byStatus).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 8 }}>{k}</td>
                  <td style={{ padding: 8 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 16 }}>
            <strong>Total requests (all time):</strong> {stats.requests}
            <br />
            <strong>Feedback submissions:</strong> {stats.feedback}
            <br />
            <strong>Email log:</strong> {stats.emailOk} rows (sent or delivered), of {stats.emailAttempted} with a
            Resend message id.
            {rate != null && (
              <>
                <br />
                <strong>Approx. success rate:</strong> {rate}%
              </>
            )}
          </p>
        </div>
      )}

      <div className="card table-scroll">
        <h2 style={{ marginTop: 0 }}>Admin accounts</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Admin</th>
              <th style={{ textAlign: 'left', padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>{u.email ?? u.id}</td>
                <td style={{ padding: 8 }}>{u.is_admin ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8 }}>
                  {!u.is_admin ? (
                    <button type="button" className="btn btn-secondary" onClick={() => void promote(u.id)}>
                      Promote
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => void demote(u.id)}>
                      Demote
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
