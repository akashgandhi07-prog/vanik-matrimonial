import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

const PAGE_SIZE = 50;

type RequestRow = {
  id: string;
  created_at: string;
  email_status: string;
  requester_id: string;
  candidate_ids: string[];
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'failed_or_skipped', label: 'Needs attention (failed / skipped)' },
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped (no email provider)' },
  { value: 'bounced', label: 'Bounced' },
] as const;

export default function AdminRequests() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFilter, setEmailFilter] = useState<(typeof FILTER_OPTIONS)[number]['value']>('all');
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = (await invokeFunction('admin-manage-users', {
          action: 'list_requests',
          page: pageNum,
          page_size: PAGE_SIZE,
          ...(emailFilter !== 'all' ? { email_status_filter: emailFilter } : {}),
        })) as { requests?: RequestRow[]; names?: Record<string, string> };
        const rows = (res.requests ?? []) as RequestRow[];
        setHasMore(rows.length === PAGE_SIZE);
        if (append) {
          setRequests((prev) => [...prev, ...rows]);
        } else {
          setRequests(rows);
        }
        if (res.names && Object.keys(res.names).length > 0) {
          setNames((prev) => ({ ...prev, ...res.names }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load requests');
      } finally {
        setLoading(false);
      }
    },
    [emailFilter]
  );

  useEffect(() => {
    setPage(1);
    void fetchPage(1, false);
  }, [fetchPage]);

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchPage(nextPage, true);
  }

  async function resendEmails(requestId: string) {
    setResendingId(requestId);
    setError(null);
    try {
      await invokeFunction('admin-manage-users', {
        action: 'resend_contact_request',
        request_id: requestId,
      });
      await fetchPage(1, false);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resend failed');
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div>
      <h1>Requests</h1>
      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label htmlFor="admin-req-filter" className="label" style={{ margin: 0 }}>
          Email status
        </label>
        <select
          id="admin-req-filter"
          value={emailFilter}
          onChange={(e) =>
            setEmailFilter(e.target.value as (typeof FILTER_OPTIONS)[number]['value'])
          }
          disabled={loading}
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        Showing {requests.length} request{requests.length !== 1 ? 's' : ''}
        {emailFilter !== 'all' ? ` (filtered)` : ''}. Use member links to open full profiles. Resend runs the
        same contact-details and candidate-notification emails as the original request.
      </p>
      <RequestsTable
        requests={requests}
        names={names}
        onResend={resendEmails}
        resendingId={resendingId}
      />
      {hasMore && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={loadMore}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function RequestsTable({
  requests,
  names,
  onResend,
  resendingId,
}: {
  requests: RequestRow[];
  names: Record<string, string>;
  onResend: (requestId: string) => void;
  resendingId: string | null;
}) {
  return (
    <div className="table-scroll">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Requester</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Candidates</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const canResend = r.email_status !== 'sent';
            return (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>{new Date(r.created_at).toLocaleString('en-GB')}</td>
                <td style={{ padding: 8 }}>
                  <Link to={`/admin/members/${r.requester_id}`}>
                    {names[r.requester_id] ?? r.requester_id}
                  </Link>
                </td>
                <td style={{ padding: 8 }}>
                  {(r.candidate_ids ?? []).map((id) => (
                    <span key={id} style={{ display: 'inline-block', marginRight: 8 }}>
                      <Link to={`/admin/members/${id}`}>{names[id] ?? id}</Link>
                    </span>
                  ))}
                </td>
                <td style={{ padding: 8 }}>{r.email_status}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  {canResend ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={resendingId === r.id}
                      onClick={() => onResend(r.id)}
                    >
                      {resendingId === r.id ? 'Sending…' : 'Resend emails'}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
