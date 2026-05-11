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

/** Field ids for CSV export — must stay aligned with `EXPORT_MEMBERS_CSV_COLUMNS` in `admin-manage-users` (`export_members_csv`). */
const MEMBER_EXPORT_COLUMN_OPTS = [
  { id: 'profile_id', label: 'Profile ID' },
  { id: 'reference_number', label: 'Reference number' },
  { id: 'full_name', label: 'Full name' },
  { id: 'first_name', label: 'First name' },
  { id: 'surname', label: 'Surname' },
  { id: 'email', label: 'Email' },
  { id: 'mobile_phone', label: 'Mobile phone' },
  { id: 'gender', label: 'Gender' },
  { id: 'seeking_gender', label: 'Seeking (gender)' },
  { id: 'age', label: 'Age' },
  { id: 'date_of_birth', label: 'Date of birth' },
  { id: 'diet', label: 'Diet' },
  { id: 'religion', label: 'Religion' },
  { id: 'community', label: 'Community' },
  { id: 'education', label: 'Education' },
  { id: 'job_title', label: 'Job title' },
  { id: 'height_cm', label: 'Height (cm)' },
  { id: 'weight_kg', label: 'Weight (kg)' },
  { id: 'nationality', label: 'Nationality' },
  { id: 'place_of_birth', label: 'Place of birth' },
  { id: 'town_country_of_origin', label: 'Town / country of origin' },
  { id: 'future_settlement_plans', label: 'Future settlement plans' },
  { id: 'hobbies', label: 'Hobbies' },
  { id: 'home_address_line1', label: 'Address line 1' },
  { id: 'home_address_city', label: 'City' },
  { id: 'home_address_postcode', label: 'Postcode' },
  { id: 'home_address_country', label: 'Country' },
  { id: 'father_name', label: "Father's name" },
  { id: 'mother_name', label: "Mother's name" },
  { id: 'status', label: 'Status' },
  { id: 'photo_status', label: 'Photo status' },
  { id: 'show_on_register', label: 'Show on register' },
  { id: 'browse_paused', label: 'Browse paused' },
  { id: 'browse_paused_at', label: 'Browse paused at' },
  { id: 'membership_expires_at', label: 'Membership expires' },
  { id: 'last_request_at', label: 'Last contact request' },
  { id: 'rejection_reason', label: 'Rejection reason' },
  { id: 'coupon_used', label: 'Coupon used' },
  { id: 'id_document_uploaded', label: 'ID document uploaded (yes/no)' },
  { id: 'pending_photo_change', label: 'Pending photo change (yes/no)' },
  { id: 'profile_created_at', label: 'Profile created at' },
  { id: 'profile_updated_at', label: 'Profile updated at' },
  { id: 'private_record_created_at', label: 'Private record created at' },
  { id: 'contact_request_weekly_bonus', label: 'Contact quota bonus (weekly)' },
  { id: 'contact_request_monthly_bonus', label: 'Contact quota bonus (monthly)' },
  { id: 'account_freeze_reminder_sent_at', label: 'Account freeze reminder sent at' },
  { id: 'staff_admin_notes', label: 'Staff notes (internal)' },
  { id: 'id_document_deleted_at', label: 'ID document deleted at' },
  { id: 'auth_user_id', label: 'Auth user ID' },
] as const;

function initialMemberExportColSelection(): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const c of MEMBER_EXPORT_COLUMN_OPTS) o[c.id] = true;
  return o;
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
  const [reportExportBusy, setReportExportBusy] = useState<'all' | 'filter' | null>(null);
  const [exportColsSelected, setExportColsSelected] = useState(initialMemberExportColSelection);

  const selectedExportColumnIds = useMemo(
    () => MEMBER_EXPORT_COLUMN_OPTS.filter((c) => exportColsSelected[c.id]).map((c) => c.id),
    [exportColsSelected]
  );
  const exportColumnsValid = selectedExportColumnIds.length > 0;

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
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Registration report (Excel / Sheets)</div>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Choose columns below (all are included by default). Exports include <strong>every member</strong> matching the
          scope you download (not just the current page of the table). Downloads open in Excel; use{' '}
          <strong>Data → PivotTable</strong> for summaries by religion, diet, gender, status, etc.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setExportColsSelected(initialMemberExportColSelection())}
          >
            Select all columns
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const o: Record<string, boolean> = {};
              for (const c of MEMBER_EXPORT_COLUMN_OPTS) o[c.id] = false;
              setExportColsSelected(o);
            }}
          >
            Clear all columns
          </button>
          {!exportColumnsValid && (
            <span style={{ color: 'var(--color-danger)', fontSize: 13 }}>Select at least one column to export.</span>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '6px 14px',
            marginBottom: 12,
            maxHeight: 280,
            overflowY: 'auto',
            padding: 8,
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: 'var(--color-surface)',
          }}
        >
          {MEMBER_EXPORT_COLUMN_OPTS.map((c) => (
            <label
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={!!exportColsSelected[c.id]}
                onChange={(e) =>
                  setExportColsSelected((s) => ({
                    ...s,
                    [c.id]: e.target.checked,
                  }))
                }
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={reportExportBusy !== null || !exportColumnsValid}
            onClick={async () => {
              setReportExportBusy('all');
              try {
                const res = (await invokeFunction('admin-manage-users', {
                  action: 'export_members_csv',
                  filter: 'all',
                  columns: selectedExportColumnIds,
                })) as { csv?: string; row_count?: number };
                const csv = typeof res.csv === 'string' ? res.csv : '';
                if (!csv) throw new Error('Empty export — deploy the latest admin-manage-users function.');
                const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `vanik-members-report-all-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Export failed');
              } finally {
                setReportExportBusy(null);
              }
            }}
          >
            {reportExportBusy === 'all' ? 'Preparing…' : 'Download all members (CSV)'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={reportExportBusy !== null || filter === 'all' || !exportColumnsValid}
            title={filter === 'all' ? 'Already includes everyone' : `Matches “${filterLabel(filter)}” only`}
            onClick={async () => {
              setReportExportBusy('filter');
              try {
                const res = (await invokeFunction('admin-manage-users', {
                  action: 'export_members_csv',
                  filter,
                  columns: selectedExportColumnIds,
                })) as { csv?: string; row_count?: number };
                const csv = typeof res.csv === 'string' ? res.csv : '';
                if (!csv) throw new Error('Empty export — deploy the latest admin-manage-users function.');
                const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `vanik-members-report-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Export failed');
              } finally {
                setReportExportBusy(null);
              }
            }}
          >
            {reportExportBusy === 'filter' ? 'Preparing…' : `Current filter: ${filterLabel(filter)}`}
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table
          className="admin-data-table admin-data-table--xl"
          style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13, background: 'white' }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: 8, width: 80, whiteSpace: 'nowrap' }}>Ref</th>
              <th style={{ padding: 8, width: 108, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Select</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                    disabled={loading || filteredMembers.length === 0}
                    onClick={() => {
                      setSelectedIds((prev) => {
                        const next = { ...prev };
                        for (const m of filteredMembers) next[m.id] = true;
                        return next;
                      });
                    }}
                  >
                    Select all
                  </button>
                </div>
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
