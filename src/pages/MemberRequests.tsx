import { Link } from 'react-router-dom';
import { useMemberArea } from '../member/memberContext';

export default function MemberRequests() {
  const { profile, candidates, requests, feedbackKeys } = useMemberArea();
  if (!profile) return null;

  return (
    <div className="card table-scroll">
      <h3 style={{ marginTop: 0 }}>Past requests</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: 8 }}>Date</th>
            <th style={{ padding: 8 }}>Candidates</th>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Feedback</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: 8 }}>{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
              <td style={{ padding: 8 }}>
                {(r.candidate_ids as string[])
                  .map((id) => candidates.find((c) => c.id === id)?.first_name ?? id)
                  .join(', ')}
              </td>
              <td style={{ padding: 8 }}>
                <span
                  className={r.email_status === 'sent' ? 'badge badge-success' : 'badge badge-danger'}
                >
                  {r.email_status}
                </span>
              </td>
              <td style={{ padding: 8, fontSize: 13 }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(r.candidate_ids as string[]).map((cid) => {
                    const key = `${r.id}:${cid}`;
                    const name = candidates.find((c) => c.id === cid)?.first_name ?? cid;
                    if (feedbackKeys.has(key)) {
                      return (
                        <li key={key} style={{ marginBottom: 4 }}>
                          {name}: <span className="badge badge-success">Received</span>
                        </li>
                      );
                    }
                    return (
                      <li key={key} style={{ marginBottom: 4 }}>
                        {name}:{' '}
                        <Link
                          to={`/feedback/${r.id}/${cid}`}
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                        >
                          Submit
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
