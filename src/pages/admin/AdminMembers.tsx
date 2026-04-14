import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { invokeFunction } from '../../lib/supabase';

type PendingPreviews = Record<
  string,
  { photo: string | null; id_document: string | null; id_is_image: boolean }
>;

type Profile = {
  id: string;
  reference_number: string | null;
  first_name: string;
  gender: string;
  status: string;
  community: string | null;
  age: number | null;
  membership_expires_at: string | null;
  last_request_at: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
};

const FILTERS = ['all', 'pending', 'active', 'expired', 'rejected', 'archived', 'matched', 'lapsed90'] as const;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function AdminMembers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const filter: (typeof FILTERS)[number] =
    filterParam && (FILTERS as readonly string[]).includes(filterParam)
      ? (filterParam as (typeof FILTERS)[number])
      : 'all';
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<Profile[]>([]);
  const [emailByProfileId, setEmailByProfileId] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreviews>({});
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'list_profiles',
        filter,
      })) as {
        profiles?: Profile[];
        emails?: Record<string, string>;
        pending_previews?: PendingPreviews;
      };
      setMembers((res.profiles ?? []) as Profile[]);
      setEmailByProfileId(res.emails ?? {});
      setPendingPreviews(filter === 'pending' ? res.pending_previews ?? {} : {});
    } catch (e) {
      setMembers([]);
      setEmailByProfileId({});
      setPendingPreviews({});
      setLoadError(e instanceof Error ? e.message : 'Could not load members');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const quickApprove = useCallback(
    async (profileId: string) => {
      if (
        !window.confirm(
          'Approve this applicant? Only confirm if you have reviewed their profile photo and ID document.'
        )
      ) {
        return;
      }
      setApproveBusyId(profileId);
      try {
        await invokeFunction('admin-approve-member', { profile_id: profileId });
        await loadMembers();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Approval failed');
      } finally {
        setApproveBusyId(null);
      }
    },
    [loadMembers]
  );

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  function changeFilter(f: (typeof FILTERS)[number]) {
    setSearchParams(f === 'all' ? {} : { filter: f });
  }

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (m.reference_number?.toLowerCase().includes(q) ?? false) ||
        m.first_name.toLowerCase().includes(q) ||
        (emailByProfileId[m.id]?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [members, search, emailByProfileId]);

  return (
    <div>
      <h1>Members</h1>
      {loadError && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 12, padding: 12 }}>
          {loadError}
        </p>
      )}
      <p className="field-hint" style={{ marginTop: -8, marginBottom: 12 }}>
        Member rows are loaded via the <code>admin-manage-users</code> edge function (service role) so pending
        applications show up even if table-level admin rules are misconfigured. You must still be an admin in
        Auth metadata to call it.
      </p>
      <input
        placeholder="Search reference, name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: 'min(100%, 360px)', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => changeFilter(f)}
          >
            {f === 'lapsed90' ? 'lapsed 90+' : f}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: 8 }}>Ref</th>
              {filter === 'pending' && (
                <>
                  <th style={{ padding: 8 }}>Photo</th>
                  <th style={{ padding: 8 }}>ID</th>
                </>
              )}
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Gender</th>
              <th style={{ padding: 8 }}>Age</th>
              <th style={{ padding: 8 }}>Community</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Expires</th>
              <th style={{ padding: 8 }}>Last request</th>
              <th style={{ padding: 8 }}>Notes</th>
              <th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={filter === 'pending' ? 12 : 10}
                  style={{ padding: 16, color: 'var(--color-text-secondary)' }}
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredMembers.length === 0 && (
              <tr>
                <td
                  colSpan={filter === 'pending' ? 12 : 10}
                  style={{ padding: 16, color: 'var(--color-text-secondary)' }}
                >
                  {loadError
                    ? 'Could not load members.'
                    : 'No rows for this filter. If you expect pending applications, confirm their status is pending_approval in Supabase and that your admin session can read all profiles (see note above).'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredMembers.map((m) => {
                const prev = pendingPreviews[m.id];
                const thumbStyle: CSSProperties = {
                  width: 56,
                  height: 56,
                  objectFit: 'cover',
                  borderRadius: 6,
                  display: 'block',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                };
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 8 }}>{m.reference_number}</td>
                    {filter === 'pending' && (
                      <>
                        <td style={{ padding: 8, verticalAlign: 'middle' }}>
                          {prev?.photo ? (
                            <img src={prev.photo} alt="" style={thumbStyle} />
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: 8, verticalAlign: 'middle' }}>
                          {prev?.id_document && prev.id_is_image ? (
                            <img src={prev.id_document} alt="" style={thumbStyle} />
                          ) : prev?.id_document && !prev.id_is_image ? (
                            <a href={prev.id_document} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                              PDF
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td style={{ padding: 8 }}>{m.first_name}</td>
                    <td style={{ padding: 8 }}>{m.gender}</td>
                    <td style={{ padding: 8 }}>{m.age}</td>
                    <td style={{ padding: 8 }}>{m.community}</td>
                    <td style={{ padding: 8 }}>{m.status}</td>
                    <td style={{ padding: 8 }}>{fmtDate(m.membership_expires_at)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(m.last_request_at)}</td>
                    <td style={{ padding: 8 }}>
                      {m.pending_photo_url && (
                        <span className="badge badge-warning" style={{ whiteSpace: 'nowrap' }}>
                          Photo pending review
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Link to={`/admin/members/${m.id}`}>Details</Link>
                        {m.status === 'pending_approval' && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: 13 }}
                            disabled={approveBusyId === m.id}
                            onClick={() => void quickApprove(m.id)}
                          >
                            {approveBusyId === m.id ? '…' : 'Approve'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
