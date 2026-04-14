import { Link } from 'react-router-dom';
import { useMemberArea } from '../member/memberContext';

export default function MemberRequests() {
  const { profile, candidates, requests, feedbackKeys } = useMemberArea();
  if (!profile) return null;

  if (requests.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        <p style={{ margin: 0, fontWeight: 500 }}>No requests yet</p>
        <p style={{ margin: '8px 0 0', fontSize: 14 }}>
          Go to <Link to="/dashboard/browse">Browse</Link> and select up to 3 candidates to request their contact details.
        </p>
      </div>
    );
  }

  return (
    <div className="card table-scroll">
      <h3 style={{ marginTop: 0 }}>Contact requests</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 0 }}>
        You can make up to 3 requests per week. Please provide feedback for each candidate once you have
        had a chance to make contact.
      </p>
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
          {requests.map((r) => {
            const allFeedbackGiven = (r.candidate_ids as string[]).every((cid) =>
              feedbackKeys.has(`${r.id}:${cid}`)
            );
            return (
              <tr
                key={r.id}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: allFeedbackGiven ? undefined : 'rgba(217, 119, 6, 0.04)',
                }}
              >
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleDateString('en-GB')}
                </td>
                <td style={{ padding: 8 }}>
                  {(r.candidate_ids as string[])
                    .map((id) => {
                      const c = candidates.find((x) => x.id === id);
                      return c ? `${c.first_name} (${c.reference_number ?? id.slice(0, 6)})` : id.slice(0, 8) + '…';
                    })
                    .join(', ')}
                </td>
                <td style={{ padding: 8 }}>
                  <span className={r.email_status === 'sent' ? 'badge badge-success' : 'badge badge-danger'}>
                    {r.email_status}
                  </span>
                </td>
                <td style={{ padding: 8, fontSize: 13 }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(r.candidate_ids as string[]).map((cid) => {
                      const key = `${r.id}:${cid}`;
                      const c = candidates.find((x) => x.id === cid);
                      const name = c ? c.first_name : cid.slice(0, 8) + '…';
                      if (feedbackKeys.has(key)) {
                        return (
                          <li key={key} style={{ marginBottom: 4 }}>
                            {name}: <span className="badge badge-success">✓ Submitted</span>
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
                            Give feedback
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
