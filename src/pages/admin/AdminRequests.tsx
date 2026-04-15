import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

const PAGE_SIZE = 50;

type RequestRow = {
  id: string;
  created_at: string;
  requester_id: string;
  candidate_ids: string[];
};

export default function AdminRequests() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = (await invokeFunction('admin-manage-users', {
          action: 'list_requests',
          page: pageNum,
          page_size: PAGE_SIZE,
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
    []
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

  return (
    <div>
      <h1>Requests</h1>
      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 12 }}>{error}</p>}
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        Showing {requests.length} request{requests.length !== 1 ? 's' : ''}. Contact details are managed
        in-app under member <strong>My requests</strong>, with no request email resend flow.
      </p>
      <RequestsTable requests={requests} names={names} />
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
}: {
  requests: RequestRow[];
  names: Record<string, string>;
}) {
  return (
    <div className="table-scroll">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Requester</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Candidates</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
