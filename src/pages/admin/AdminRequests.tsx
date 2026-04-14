import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const PAGE_SIZE = 50;

type RequestRow = {
  id: string;
  created_at: string;
  email_status: string;
  requester_id: string;
  candidate_ids: string[];
};

export default function AdminRequests() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  async function fetchPage(pageNum: number, append: boolean) {
    setLoading(true);
    const from = (pageNum - 1) * PAGE_SIZE;
    const to = pageNum * PAGE_SIZE - 1;
    const { data } = await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);
    const rows = (data ?? []) as RequestRow[];
    setHasMore(rows.length === PAGE_SIZE);
    if (append) {
      setRequests((prev) => [...prev, ...rows]);
    } else {
      setRequests(rows);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchPage(1, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchPage(nextPage, true);
  }

  return (
    <div>
      <h1>Requests</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        Showing {requests.length} request{requests.length !== 1 ? 's' : ''}
      </p>
      <RequestsTable requests={requests} />
      {hasMore && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function RequestsTable({
  requests,
}: {
  requests: RequestRow[];
}) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = new Set<string>();
    requests.forEach((r) => {
      ids.add(r.requester_id);
      (r.candidate_ids as string[])?.forEach((c) => ids.add(c));
    });
    if (ids.size === 0) return;
    void (async () => {
      const { data } = await supabase.from('profiles').select('id, first_name, reference_number').in('id', [...ids]);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: { id: string; first_name: string; reference_number: string | null }) => {
        map[p.id] = `${p.first_name} (${p.reference_number ?? '-'})`;
      });
      setNames((prev) => ({ ...prev, ...map }));
    })();
  }, [requests]);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
          <th style={{ textAlign: 'left', padding: 8 }}>Requester</th>
          <th style={{ textAlign: 'left', padding: 8 }}>Candidates</th>
          <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
            <td style={{ padding: 8 }}>{new Date(r.created_at).toLocaleString('en-GB')}</td>
            <td style={{ padding: 8 }}>{names[r.requester_id] ?? r.requester_id}</td>
            <td style={{ padding: 8 }}>
              {(r.candidate_ids ?? []).map((id) => names[id] ?? id).join(', ')}
            </td>
            <td style={{ padding: 8 }}>{r.email_status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
