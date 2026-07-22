import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '../../lib/supabase';

type ErrorRow = {
  id: string;
  error_code: string;
  area: string;
  message: string | null;
  detail: Record<string, unknown> | null;
  auth_user_id: string | null;
  profile_id: string | null;
  user_email: string | null;
  page_url: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function AdminErrorLog() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_client_errors',
        limit: 200,
        search: term,
      })) as { rows?: ErrorRow[] };
      setRows((res.rows ?? []) as ErrorRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load error log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div>
      <h1>Error log</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 700 }}>
        When something fails for a member, the site shows them a short reference code only (for example{' '}
        <strong>VMR-K3F7QP</strong>) and records the technical detail here. Paste a member&rsquo;s code into
        the search box to find exactly what went wrong for them.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(search.trim());
        }}
        style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Reference code, email, or area"
          style={{ minWidth: 260 }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        {search && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSearch('');
              void load('');
            }}
          >
            Clear
          </button>
        )}
      </form>
      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>}
      {!loading && rows.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {search ? 'No errors match that search.' : 'No errors logged. '}
        </p>
      )}
      <div className="table-scroll">
        <table
          className="admin-data-table"
          style={{ borderCollapse: 'collapse', fontSize: 14, background: 'white' }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>When</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Reference</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Area</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Member</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Page</th>
              <th style={{ textAlign: 'left', padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleString('en-GB')}
                </td>
                <td style={{ padding: 8, fontWeight: 600, letterSpacing: '0.04em' }}>{r.error_code}</td>
                <td style={{ padding: 8 }}>{r.area}</td>
                <td style={{ padding: 8 }}>{r.user_email ?? 'Not signed in'}</td>
                <td style={{ padding: 8, fontSize: 12 }}>{r.page_url ?? '-'}</td>
                <td style={{ padding: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  >
                    {expanded === r.id ? 'Hide' : 'Detail'}
                  </button>
                  {expanded === r.id && (
                    <pre
                      style={{
                        marginTop: 8,
                        maxWidth: 520,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 12,
                        background: 'var(--color-surface-alt, #f6f5f2)',
                        padding: 8,
                        borderRadius: 4,
                      }}
                    >
                      {JSON.stringify(
                        {
                          message: r.message,
                          detail: r.detail,
                          auth_user_id: r.auth_user_id,
                          profile_id: r.profile_id,
                          user_agent: r.user_agent,
                        },
                        null,
                        2,
                      )}
                    </pre>
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
