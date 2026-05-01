import { useCallback, useEffect, useState } from 'react';
import { adminPowerRole } from '../../lib/auth';
import { invokeFunction, supabase } from '../../lib/supabase';

type AuthRow = {
  id: string;
  email: string | undefined;
  is_admin: boolean;
  admin_role: 'super' | 'support' | null;
  created_at: string;
};

type MailProviderStatus = {
  configured: boolean;
  smtp_user_present: boolean;
  smtp_pass_present: boolean;
  resend_present: boolean;
  edge_supabase_host: string | null;
};

function browserSupabaseHost(): string | null {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).host;
  } catch {
    return null;
  }
}

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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myPowerRole, setMyPowerRole] = useState<'super' | 'support' | null>(null);
  const [mailStatus, setMailStatus] = useState<MailProviderStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [listRes, statsRes, mailRes] = await Promise.all([
        invokeFunction('admin-manage-users', { action: 'list' }) as Promise<{ users?: AuthRow[] }>,
        invokeFunction('admin-manage-users', { action: 'settings_stats' }) as Promise<{
          byStatus?: Record<string, number>;
          requests?: number;
          feedback?: number;
          emailAttempted?: number;
          emailOk?: number;
        }>,
        invokeFunction('admin-manage-users', { action: 'mail_provider_status' }) as Promise<MailProviderStatus>,
      ]);
      setMailStatus(
        mailRes &&
          typeof mailRes.configured === 'boolean' &&
          typeof mailRes.smtp_user_present === 'boolean' &&
          typeof mailRes.smtp_pass_present === 'boolean'
          ? mailRes
          : null
      );
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
      setMailStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
      setMyPowerRole(data.user ? adminPowerRole(data.user) : null);
    });
  }, []);

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

  async function setUserRole(id: string, role: 'super' | 'support') {
    if (id === currentUserId) {
      alert('Ask another super admin to change your own role.');
      return;
    }
    try {
      await invokeFunction('admin-manage-users', { action: 'set_admin_role', user_id: id, role });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    }
  }

  const rate =
    stats && stats.emailAttempted > 0
      ? Math.round((stats.emailOk / stats.emailAttempted) * 1000) / 10
      : null;

  const viteHost = browserSupabaseHost();
  const hostMismatch =
    mailStatus?.edge_supabase_host &&
    viteHost &&
    mailStatus.edge_supabase_host !== viteHost;

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ color: 'var(--color-text-secondary)', maxWidth: 720 }}>
        Promote or demote administrators. New admins are <strong>super</strong> by default. You can switch an admin to{' '}
        <strong>support</strong> for read-mostly access (no approvals, full record edits, coupons, or high‑risk account
        tools). Demotion is blocked if this would remove the last admin. See{' '}
        <code style={{ fontSize: 13 }}>docs/SETUP.md</code> for creating the first and second admin accounts.
      </p>
      {myPowerRole === 'support' && (
        <p className="card" style={{ marginBottom: 16, padding: 12, background: '#f6f4e8' }}>
          You are a <strong>support</strong> admin: promoting, demoting, and role changes require a super admin.
        </p>
      )}

      {loadError && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 16, padding: 12 }}>
          {loadError}
        </p>
      )}

      {loading && <p>Loading…</p>}

      {mailStatus && (
        <div
          className="card"
          style={{
            marginBottom: 24,
            padding: 16,
            background: mailStatus.configured && !hostMismatch ? 'var(--color-surface)' : '#fff8e6',
            border: '1px solid var(--color-border)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Email delivery (Edge Functions)</h2>
          <p style={{ marginBottom: 12, fontSize: 14, color: 'var(--color-text-secondary)' }}>
            Transactional mail (approvals, reminders, etc.) uses SMTP or Resend secrets on the{' '}
            <strong>same</strong> Supabase project your app calls. Auth “forgot password” uses Dashboard SMTP
            separately.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
            <li>
              <strong>Edge sees SMTP user:</strong> {mailStatus.smtp_user_present ? 'yes' : 'no'}
            </li>
            <li>
              <strong>Edge sees SMTP password:</strong> {mailStatus.smtp_pass_present ? 'yes' : 'no'}
            </li>
            <li>
              <strong>Resend API key:</strong> {mailStatus.resend_present ? 'set' : 'not set'}
            </li>
            <li>
              <strong>Ready to send from Edge:</strong> {mailStatus.configured ? 'yes' : 'no'}
            </li>
            <li>
              <strong>Functions project host:</strong>{' '}
              <code style={{ fontSize: 13 }}>{mailStatus.edge_supabase_host ?? '—'}</code>
            </li>
            <li>
              <strong>This build’s VITE_SUPABASE_URL host:</strong>{' '}
              <code style={{ fontSize: 13 }}>{viteHost ?? '—'}</code>
            </li>
          </ul>
          {hostMismatch && (
            <p style={{ marginTop: 12, color: 'var(--color-danger)', fontSize: 14 }}>
              Host mismatch: secrets apply to <code>{mailStatus.edge_supabase_host}</code> but this site is configured
              for <code>{viteHost}</code>. Update Vercel (or env) so <code>VITE_SUPABASE_URL</code> matches the project
              where you set SMTP secrets, then redeploy the frontend.
            </p>
          )}
        </div>
      )}

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
        <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Admin</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Role</th>
              <th style={{ textAlign: 'left', padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>{u.email ?? u.id}</td>
                <td style={{ padding: 8 }}>{u.is_admin ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8 }}>{u.is_admin ? (u.admin_role ?? 'super') : '-'}</td>
                <td style={{ padding: 8 }}>
                  {myPowerRole !== 'support' && !u.is_admin ? (
                    <button type="button" className="btn btn-secondary" onClick={() => void promote(u.id)}>
                      Promote
                    </button>
                  ) : myPowerRole !== 'support' && u.is_admin ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => void demote(u.id)}>
                        Demote
                      </button>
                      {u.id !== currentUserId && (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void setUserRole(u.id, 'support')}
                          >
                            Set support
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void setUserRole(u.id, 'super')}
                          >
                            Set super
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>-</span>
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
