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

export default function AdminEmailLog() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    try {
      await invokeFunction('send-email', {
        type: r.email_type,
        recipient_profile_id: r.recipient_profile_id,
        recipient_email: r.recipient_email,
      });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1>Email log</h1>
      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
        Configure Resend webhooks to POST to your deployed Edge Function{' '}
        <code style={{ fontSize: 13 }}>/functions/v1/resend-webhook</code>. In local dev, Vite proxies{' '}
        <code style={{ fontSize: 13 }}>/api/resend-webhook</code> to the same function (requires a tunnel such as
        ngrok for Resend to reach your machine).
      </p>
      <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Sent</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 8 }}>To</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Resend ID</th>
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
                  {r.status}
                  {r.failure_detail && (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)' }}>
                      {r.failure_detail.slice(0, 120)}
                    </span>
                  )}
                </td>
                <td style={{ padding: 8, fontSize: 12 }}>{r.resend_message_id ?? '-'}</td>
                <td style={{ padding: 8 }}>
                  {(r.status === 'failed' || r.status === 'bounced') && (
                    <button type="button" className="btn btn-secondary" onClick={() => void resend(r)}>
                      Resend
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
