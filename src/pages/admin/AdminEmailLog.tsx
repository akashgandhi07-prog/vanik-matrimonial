import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '../../lib/supabase';

type LogRow = {
  id: string;
  recipient_email: string | null;
  recipient_profile_id: string | null;
  email_type: string;
  subject: string | null;
  resend_message_id: string | null;
  status: string;
  sent_at: string;
  failure_detail: string | null;
};

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  delivered: { color: 'var(--color-success)', label: 'Delivered' },
  sent: { color: 'var(--color-text-secondary)', label: 'Sent (awaiting delivery info)' },
  deferred: { color: 'var(--color-warning)', label: 'Deferred (retrying)' },
  bounced: { color: 'var(--color-danger)', label: 'Bounced' },
  blocked: { color: 'var(--color-danger)', label: 'Blocked' },
  spam: { color: 'var(--color-danger)', label: 'Marked spam' },
  failed: { color: 'var(--color-danger)', label: 'Failed to send' },
  skipped: { color: 'var(--color-text-secondary)', label: 'Skipped' },
};

export default function AdminEmailLog() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Row id currently being resent, so its button disables and we avoid duplicate sends. */
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_email_log',
        limit: 300,
      })) as { rows?: LogRow[] };
      setRows((res.rows ?? []) as LogRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load email log');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- email log from Edge Function
    void load();
  }, [load]);

  async function resend(r: LogRow) {
    if (resendingId) return;
    setResendingId(r.id);
    try {
      await invokeFunction('send-email', {
        type: r.email_type,
        recipient_profile_id: r.recipient_profile_id,
        recipient_email: r.recipient_email,
      });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setResendingId(null);
    }
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const problems = (counts.bounced ?? 0) + (counts.blocked ?? 0) + (counts.spam ?? 0) + (counts.failed ?? 0);

  return (
    <div>
      <h1>Email log</h1>
      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
        Delivery statuses come from Brevo: <strong>Delivered</strong> means it reached the recipient&apos;s mail
        server; <strong>Sent</strong> means it was accepted but no delivery confirmation has arrived yet.
      </p>
      {rows.length > 0 && (
        <p style={{ fontSize: 14, marginBottom: 14 }}>
          Last {rows.length} emails:{' '}
          <strong style={{ color: 'var(--color-success)' }}>{counts.delivered ?? 0} delivered</strong> ·{' '}
          {counts.sent ?? 0} awaiting info · {counts.deferred ?? 0} retrying ·{' '}
          <strong style={{ color: problems > 0 ? 'var(--color-danger)' : undefined }}>{problems} problems</strong>
        </p>
      )}
      <div className="table-scroll">
        <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Sent</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 8 }}>To</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Message ID</th>
              <th style={{ textAlign: 'left', padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>{new Date(r.sent_at).toLocaleString('en-GB')}</td>
                <td style={{ padding: 8 }}>{r.email_type}</td>
                <td style={{ padding: 8 }}>{r.recipient_email ?? '-'}</td>
                <td style={{ padding: 8 }}>
                  <span style={{ color: STATUS_STYLE[r.status]?.color, fontWeight: 600 }}>
                    {STATUS_STYLE[r.status]?.label ?? r.status}
                  </span>
                  {r.failure_detail && (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)' }}>
                      {r.failure_detail.slice(0, 120)}
                    </span>
                  )}
                </td>
                <td style={{ padding: 8, fontSize: 12 }}>{r.resend_message_id ?? '-'}</td>
                <td style={{ padding: 8 }}>
                  {(r.status === 'failed' || r.status === 'bounced') && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={resendingId === r.id}
                      onClick={() => void resend(r)}
                    >
                      {resendingId === r.id ? 'Resending…' : 'Resend'}
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
