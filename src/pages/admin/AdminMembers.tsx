import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isSupportAdmin } from '../../lib/auth';
import { invokeFunction, supabase } from '../../lib/supabase';

type PendingPreviews = Record<
  string,
  { photo: string | null; photos?: string[]; id_document: string | null; id_is_image: boolean }
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
  created_at: string;
};

const FILTERS = [
  'all',
  'pending',
  'active',
  'expired',
  'rejected',
  'rejected30',
  'archived',
  'matched',
  'lapsed90',
  'photo_pending',
  'expires60',
] as const;

function filterCandidates(filter: (typeof FILTERS)[number]): string[] {
  if (filter === 'photo_pending') return ['photo_pending', 'photoPending', 'pending_photo', 'photo-pending'];
  if (filter === 'rejected30') return ['rejected30', 'rejected_30', 'rejected-30'];
  if (filter === 'expires60') return ['expires60', 'expires_60', 'expiring60', 'expiring_60'];
  if (filter === 'lapsed90') return ['lapsed90', 'lapsed_90', 'long_lapsed', 'lapsed365'];
  return [filter];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function daysWaiting(createdAt: string | undefined): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

function filterLabel(f: (typeof FILTERS)[number]): string {
  if (f === 'rejected30') return 'Rejected (30d)';
  if (f === 'photo_pending') return 'Photo pending';
  if (f === 'expires60') return 'Expires ≤60d';
  if (f === 'lapsed90') return 'Long-lapsed (365+ days past expiry)';
  return f;
}

export default function AdminMembers() {
  const [supportOnly, setSupportOnly] = useState(false);
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
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      let res:
        | {
            profiles?: Profile[];
            emails?: Record<string, string>;
            pending_previews?: PendingPreviews;
          }
        | null = null;
      let lastError: unknown = null;
      const candidates = filterCandidates(filter);
      for (const f of candidates) {
        try {
          res = (await invokeFunction('admin-manage-users', {
            action: 'list_profiles',
            filter: f,
          })) as {
            profiles?: Profile[];
            emails?: Record<string, string>;
            pending_previews?: PendingPreviews;
          };
          break;
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message.toLowerCase() : '';
          if (!msg.includes('invalid filter')) throw e;
        }
      }
      if (!res) throw (lastError instanceof Error ? lastError : new Error('Could not load members'));
      setMembers((res.profiles ?? []) as Profile[]);
      setEmailByProfileId(res.emails ?? {});
      setPendingPreviews(filter === 'pending' ? res.pending_previews ?? {} : {});
      setSelectedIds({});
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

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setSupportOnly(isSupportAdmin(data.user));
    });
  }, []);

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

  const selectedCount = useMemo(
    () => Object.keys(selectedIds).filter((id) => selectedIds[id]).length,
    [selectedIds]
  );

  const tableColCount = filter === 'pending' ? 14 : 11;

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
      <div className="admin-filter-chips">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => changeFilter(f)}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const next: Record<string, boolean> = {};
            for (const m of filteredMembers) next[m.id] = true;
            setSelectedIds(next);
          }}
        >
          Select all in view
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setSelectedIds({})}>
          Clear selection
        </button>
        {filter === 'pending' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={bulkBusy || selectedCount === 0}
            onClick={async () => {
              const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
              if (!ids.length) return;
              if (!window.confirm(`Send pending reminder email to ${ids.length} applicant(s)?`)) return;
              setBulkBusy(true);
              try {
                const res = (await invokeFunction('admin-manage-users', {
                  action: 'send_pending_reminders',
                  profile_ids: ids,
                })) as { sent?: number; skipped?: number };
                alert(`Sent: ${res.sent ?? 0}. Skipped (not pending): ${res.skipped ?? 0}.`);
                setSelectedIds({});
                await loadMembers();
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Failed');
              } finally {
                setBulkBusy(false);
              }
            }}
          >
            {bulkBusy ? 'Sending…' : 'Send reminder to selected'}
          </button>
        )}
        {!supportOnly && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: 'var(--color-danger)' }}
            disabled={selectedCount === 0}
            onClick={() => {
              setDeleteConfirmText('');
              setDeleteModalOpen(true);
            }}
          >
            Delete selected permanently…
          </button>
        )}
      </div>
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const rows = filteredMembers;
            const headers = ['reference', 'first_name', 'email', 'status', 'created_at', 'profile_id'];
            const lines = [
              headers.join(','),
              ...rows.map((m) =>
                [
                  m.reference_number ?? '',
                  `"${(m.first_name ?? '').replace(/"/g, '""')}"`,
                  `"${(emailByProfileId[m.id] ?? '').replace(/"/g, '""')}"`,
                  m.status,
                  m.created_at ?? '',
                  m.id,
                ].join(',')
              ),
            ];
            const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `members-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download CSV (current table view)
        </button>
      </div>
      <div className="table-scroll">
        <table
          className="admin-data-table admin-data-table--xl"
          style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13, background: 'white' }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: 8, width: 80, whiteSpace: 'nowrap' }}>Ref</th>
              <th style={{ padding: 8, width: 44, whiteSpace: 'nowrap' }} title="Select for bulk actions">
                Sel
              </th>
              {filter === 'pending' && (
                <>
                  <th style={{ padding: 8, width: 72, whiteSpace: 'nowrap' }}>Photo</th>
                  <th style={{ padding: 8, width: 56, whiteSpace: 'nowrap' }}>ID</th>
                  <th style={{ padding: 8, width: 86, whiteSpace: 'nowrap' }}>Waiting</th>
                </>
              )}
              <th style={{ padding: 8, width: 124 }}>Name</th>
              <th style={{ padding: 8, width: 220 }}>Email</th>
              <th style={{ padding: 8, width: 72, whiteSpace: 'nowrap' }}>Gender</th>
              <th style={{ padding: 8, width: 52, whiteSpace: 'nowrap' }}>Age</th>
              <th style={{ padding: 8, width: 128, whiteSpace: 'nowrap' }}>Status</th>
              <th style={{ padding: 8, width: 92, whiteSpace: 'nowrap' }}>Expires</th>
              <th style={{ padding: 8, width: 92, whiteSpace: 'nowrap' }}>Last request</th>
              <th style={{ padding: 8, width: 110, whiteSpace: 'nowrap' }}>Notes</th>
              <th style={{ padding: 8, width: 98, whiteSpace: 'nowrap' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={tableColCount} style={{ padding: 16, color: 'var(--color-text-secondary)' }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredMembers.length === 0 && (
              <tr>
                <td colSpan={tableColCount} style={{ padding: 16, color: 'var(--color-text-secondary)' }}>
                  {loadError
                    ? 'Could not load members.'
                    : 'No rows for this filter. If you expect pending applications, confirm their status is pending_approval in Supabase and that your admin session can read all profiles (see note above).'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredMembers.map((m) => {
                const prev = pendingPreviews[m.id];
                const wait = daysWaiting(m.created_at);
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
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{m.reference_number}</td>
                    <td style={{ padding: 8, verticalAlign: 'middle' }}>
                      <input
                        type="checkbox"
                        checked={!!selectedIds[m.id]}
                        onChange={(e) => setSelectedIds((s) => ({ ...s, [m.id]: e.target.checked }))}
                        aria-label={`Select ${m.first_name}`}
                      />
                    </td>
                    {filter === 'pending' && (
                      <>
                        <td style={{ padding: 8, verticalAlign: 'middle' }}>
                          {(prev?.photos?.length ?? 0) > 0 ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              {prev?.photos?.slice(0, 3).map((url, idx) => (
                                <img key={url} src={url} alt="" style={thumbStyle} title={`Photo ${idx + 1}`} />
                              ))}
                            </div>
                          ) : prev?.photo ? (
                            <img src={prev.photo} alt="" style={thumbStyle} />
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>-</span>
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
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: 8, verticalAlign: 'middle', fontSize: 13 }}>
                          {wait != null ? (
                            <>
                              <span>{wait}d</span>
                              {wait >= 7 && (
                                <span className="badge badge-warning" style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>
                                  7d+
                                </span>
                              )}
                            </>
                          ) : (
                            '-'
                          )}
                        </td>
                      </>
                    )}
                    <td style={{ padding: 8 }}>
                      <span
                        title={m.first_name}
                        style={{
                          display: 'inline-block',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                      >
                        {m.first_name}
                      </span>
                    </td>
                    <td style={{ padding: 8, maxWidth: 280 }}>
                      <span
                        title={emailByProfileId[m.id] ?? '-'}
                        style={{
                          display: 'inline-block',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                      >
                        {emailByProfileId[m.id] ?? '-'}
                      </span>
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{m.gender}</td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{m.age}</td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{m.status}</td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmtDate(m.membership_expires_at)}</td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmtDate(m.last_request_at)}</td>
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
                        {m.status === 'pending_approval' && !supportOnly && (
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

      {deleteModalOpen && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="admin-bulk-del-title"
          className="modal-backdrop"
          onClick={() => !deleteBusy && setDeleteModalOpen(false)}
        >
          <div className="card modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 id="admin-bulk-del-title" style={{ marginTop: 0 }}>
              Permanently delete members
            </h3>
            <p style={{ marginBottom: 12 }}>
              This will remove <strong>{selectedCount}</strong> selected member account(s): auth login, profile,
              private details, and related data (same as automated purge after archival). Storage photos and ID files
              are removed where possible. This cannot be undone.
            </p>
            <p style={{ marginBottom: 8 }}>
              Type <strong>DELETE</strong> to confirm.
            </p>
            <label className="label" htmlFor="admin-bulk-del-confirm">
              Confirmation
            </label>
            <input
              id="admin-bulk-del-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              disabled={deleteBusy}
            />
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleteBusy}
                onClick={() => setDeleteModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--color-danger)' }}
                disabled={deleteBusy || deleteConfirmText !== 'DELETE'}
                onClick={async () => {
                  if (deleteConfirmText !== 'DELETE') return;
                  const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
                  if (!ids.length) return;
                  setDeleteBusy(true);
                  try {
                    const res = (await invokeFunction('admin-manage-users', {
                      action: 'delete_members_permanent',
                      confirm_text: 'DELETE',
                      profile_ids: ids,
                    })) as {
                      deleted?: string[];
                      failed?: { profile_id: string; error: string }[];
                    };
                    const deleted = res.deleted ?? [];
                    const failed = res.failed ?? [];
                    const parts = [
                      `Removed ${deleted.length} account(s).`,
                      failed.length ? `Failed (${failed.length}): ${failed.map((f) => `${f.profile_id}: ${f.error}`).join('; ')}` : '',
                    ].filter(Boolean);
                    alert(parts.join('\n\n'));
                    setDeleteModalOpen(false);
                    setSelectedIds({});
                    await loadMembers();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Delete failed');
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
