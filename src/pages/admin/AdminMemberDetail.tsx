import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { fetchPhotoSignedUrl, invokeFunction, supabase } from '../../lib/supabase';
import { MfaEnroll } from './MfaEnroll';
import { useAdminGuard } from './useAdminGuard';

type Profile = {
  id: string;
  reference_number: string | null;
  first_name: string;
  gender: string;
  status: string;
  community: string | null;
  age: number | null;
  membership_expires_at: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
  rejection_reason: string | null;
  show_on_register: boolean;
  auth_user_id: string;
};

type PrivateRow = {
  surname: string;
  email: string;
  mobile_phone: string;
  date_of_birth: string;
  id_document_url: string | null;
  father_name: string | null;
  mother_name: string | null;
};

type TimelineRow = {
  id: string;
  action_type: string;
  notes: string | null;
  created_at: string;
  admin_email: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  approved: 'Application approved',
  rejected: 'Application rejected',
  marked_matched: 'Marked as matched',
  photo_approved: 'Profile photo approved',
  photo_rejected: 'Profile photo rejected',
};

function humanizeAction(type: string) {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

export default function AdminMemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, mfaOk, refresh } = useAdminGuard();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [priv, setPriv] = useState<PrivateRow | null>(null);
  const [signedIdUrl, setSignedIdUrl] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [checklist, setChecklist] = useState([false, false, false, false]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);

  useEffect(() => {
    if (!id || ok !== true || mfaOk !== true) return;
    void (async () => {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', id).single();
      setProfile(p as Profile);
      const { data: m } = await supabase.from('member_private').select('*').eq('profile_id', id).single();
      setPriv(m as PrivateRow);
      if (p) {
        const u = await fetchPhotoSignedUrl(p.id);
        setPhotoUrl(u);
      }
    })();
  }, [id, ok, mfaOk]);

  useEffect(() => {
    if (!id || ok !== true || mfaOk !== true) return;
    void (async () => {
      const { data, error } = await supabase.rpc('admin_actions_for_profile', {
        p_profile_id: id,
      });
      if (error) {
        console.warn(error.message);
        setTimeline([]);
        return;
      }
      setTimeline((data ?? []) as TimelineRow[]);
    })();
  }, [id, ok, mfaOk]);

  useEffect(() => {
    const path = profile?.pending_photo_url;
    if (!path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear preview when no pending upload
      setPendingPreview(null);
      return;
    }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.storage.from('profile-photos').createSignedUrl(path, 900);
      if (alive && !error) setPendingPreview(data?.signedUrl ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [profile?.pending_photo_url]);

  async function viewIdDoc() {
    if (!priv?.id_document_url) return;
    const { data, error } = await supabase.storage
      .from('id-documents')
      .createSignedUrl(priv.id_document_url, 900);
    if (error) {
      alert(error.message);
      return;
    }
    setSignedIdUrl(data?.signedUrl ?? null);
  }

  if (ok === false) return <Navigate to="/dashboard/browse" replace />;
  if (ok === null || mfaOk === null) {
    return <div className="layout-max">Loading…</div>;
  }
  if (!mfaOk) return <MfaEnroll onDone={() => void refresh()} />;
  if (!profile || !priv) {
    return <div className="layout-max">Loading…</div>;
  }

  const pending = profile.status === 'pending_approval';
  const canMarkMatched =
    !pending && profile.status !== 'matched' && profile.status !== 'archived' && profile.status !== 'rejected';

  return (
    <div>
      <p style={{ marginBottom: 16 }}>
        <Link to="/admin/members">← Members</Link>
      </p>
      <h1>
          {profile.first_name} {priv.surname}
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {profile.reference_number} · {profile.status}
          {profile.show_on_register ? ' · on register' : ''}
        </p>

        {canMarkMatched && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Membership status</h3>
            <button type="button" className="btn btn-primary" onClick={() => setMatchOpen(true)}>
              Mark as matched…
            </button>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            marginTop: 24,
          }}
        >
          <div className="card">
            <h3>Profile photo</h3>
            {photoUrl && (
              <img
                src={photoUrl}
                alt={`${profile.first_name}'s profile photo`}
                style={{ width: '100%', maxWidth: 320, borderRadius: 8 }}
              />
            )}
          </div>
          <div className="card">
            <h3>ID document</h3>
            {pending && priv.id_document_url ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => void viewIdDoc()}>
                  View ID document (15 min link)
                </button>
                {signedIdUrl && (
                  <p style={{ marginTop: 12 }}>
                    <a href={signedIdUrl} target="_blank" rel="noreferrer">
                      Open document
                    </a>
                  </p>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--color-text-secondary)' }}>No ID on file (cleared after approval).</p>
            )}
          </div>
        </div>

        {pending && (
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Approval checklist</h3>
            {[
              'Name on ID matches registration name',
              'Date of birth on ID matches stated DOB',
              'Photo is appropriate and clearly shows face',
              'Age 18+',
            ].map((label, i) => (
              <label key={label} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={checklist[i]}
                  onChange={(e) => {
                    const n = [...checklist];
                    n[i] = e.target.checked;
                    setChecklist(n);
                  }}
                />
                {label}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--color-success)' }}
                disabled={!checklist.every(Boolean)}
                onClick={async () => {
                  try {
                    await invokeFunction('admin-approve-member', { profile_id: profile.id });
                    navigate('/admin/members');
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  }
                }}
              >
                Approve
              </button>
            </div>
            <div style={{ marginTop: 24 }}>
              <label className="label">Reject reason</label>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--color-danger)', marginTop: 8 }}
                disabled={!rejectReason.trim()}
                onClick={async () => {
                  try {
                    await invokeFunction('admin-reject-member', {
                      profile_id: profile.id,
                      reason: rejectReason,
                    });
                    navigate('/admin/members');
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  }
                }}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {!pending && profile.pending_photo_url && (
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Pending photo review</h3>
            {pendingPreview && (
              <img
                src={pendingPreview}
                alt={`${profile.first_name}'s pending profile photo`}
                style={{ width: '100%', maxWidth: 320, borderRadius: 8, marginBottom: 12 }}
              />
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--color-success)' }}
              onClick={async () => {
                try {
                  await invokeFunction('admin-resolve-pending-photo', {
                    profile_id: profile.id,
                    action: 'approve',
                  });
                  navigate('/admin/members');
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed');
                }
              }}
            >
              Approve new photo
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                try {
                  await invokeFunction('admin-resolve-pending-photo', {
                    profile_id: profile.id,
                    action: 'reject',
                  });
                  navigate('/admin/members');
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed');
                }
              }}
            >
              Reject new photo (keep current)
            </button>
          </div>
        )}

        <div className="card" style={{ marginTop: 24 }}>
          <h3>Private details</h3>
          <p>
            Email: {priv.email}
            <br />
            Mobile: {priv.mobile_phone}
            <br />
            DOB: {priv.date_of_birth}
          </p>
        </div>

        <div className="card table-scroll" style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Admin activity timeline</h3>
          {timeline.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>No admin actions recorded yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {timeline.map((row) => (
                <li
                  key={row.id}
                  style={{
                    borderLeft: '3px solid var(--color-primary)',
                    padding: '12px 16px',
                    marginBottom: 12,
                    background: '#fafafa',
                    borderRadius: '0 8px 8px 0',
                  }}
                >
                  <strong>{humanizeAction(row.action_type)}</strong>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginLeft: 8 }}>
                    {new Date(row.created_at).toLocaleString('en-GB')}
                  </span>
                  <p style={{ margin: '6px 0 0', fontSize: 14 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>By:</span>{' '}
                    {row.admin_email ?? '—'}
                  </p>
                  {row.notes && (
                    <p style={{ margin: '8px 0 0', fontSize: 14 }}>{row.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {matchOpen && (
          <div
            role="dialog"
            aria-modal
            aria-labelledby="match-dialog-title"
            className="modal-backdrop"
            onClick={() => setMatchOpen(false)}
          >
            <div className="card modal-panel" onClick={(e) => e.stopPropagation()}>
              <h2 id="match-dialog-title" style={{ marginTop: 0 }}>
                Mark as matched
              </h2>
              <p>
                This sets status to <strong>matched</strong>, hides the profile from the register (
                <code>show_on_register = false</code>), sends the congratulations email, and logs an admin action.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setMatchOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await invokeFunction('admin-mark-matched', { profile_id: profile.id });
                      setMatchOpen(false);
                      navigate('/admin/members');
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
