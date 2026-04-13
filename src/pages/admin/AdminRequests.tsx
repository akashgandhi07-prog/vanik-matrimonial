import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function AdminRequests() {
  const [requests, setRequests] = useState<
    {
      id: string;
      created_at: string;
      email_status: string;
      requester_id: string;
      candidate_ids: string[];
    }[]
  >([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      setRequests((data ?? []) as typeof requests);
    })();
  }, []);

  return (
    <div>
      <h1>Requests</h1>
      <RequestsTable requests={requests} />
    </div>
  );
}

function RequestsTable({
  requests,
}: {
  requests: {
    id: string;
    created_at: string;
    email_status: string;
    requester_id: string;
    candidate_ids: string[];
  }[];
}) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = new Set<string>();
    requests.forEach((r) => {
      ids.add(r.requester_id);
      (r.candidate_ids as string[])?.forEach((c) => ids.add(c));
    });
    void (async () => {
      const { data } = await supabase.from('profiles').select('id, first_name, reference_number').in('id', [...ids]);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: { id: string; first_name: string; reference_number: string | null }) => {
        map[p.id] = `${p.first_name} (${p.reference_number ?? '—'})`;
      });
      setNames(map);
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
