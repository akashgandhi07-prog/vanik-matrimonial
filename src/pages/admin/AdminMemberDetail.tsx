import imageCompression from 'browser-image-compression';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { isSupportAdmin } from '../../lib/auth';
import { rejectReasonIfNotJpegOrPng } from '../../lib/profilePhotoAccept';
import { invokeFunction, supabase } from '../../lib/supabase';
import { AdminMemberEditForm, type MemberPrivateFull, type MemberProfileFull } from './AdminMemberEditForm';
import { MfaEnroll } from './MfaEnroll';
import { useAdminGuard } from './useAdminGuard';

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
  archived: 'Member archived',
  reinstated: 'Member reinstated',
  profile_admin_edit: 'Profile updated (admin edit)',
  photo_admin_upload: 'Profile photo uploaded (admin)',
  internal_note_updated: 'Internal staff note updated',
  id_document_purged: 'ID document purged from storage',
  email_resent: 'Transactional email re-sent',
  bulk_pending_reminder: 'Bulk pending reminder sent',
  impersonation_magic_link: 'Member magic link generated (support access)',
  sessions_revoked: 'All sessions invalidated',
  password_recovery_sent: 'Password recovery email sent',
  admin_role_changed: 'Admin role changed',
};

function humanizeAction(type: string) {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

const REJECTION_REASON_TEMPLATES: { label: string; text: string }[] = [
  {
    label: 'Profile photo',
    text: 'Your profile photo does not meet our guidelines - please upload a clear, recent head-and-shoulders picture with your face visible and well lit (similar to a passport-style photo, without filters or heavy editing).',
  },
  {
    label: 'Proof of identity',
    text: 'Your proof of identity was unclear or incomplete - please upload a sharp, colour image of your passport photo page or driving licence (full page, all corners visible, no glare).',
  },
  {
    label: 'Name / DOB mismatch',
    text: 'The name or date of birth on your ID does not match the details you provided - please correct your details in your application and upload matching ID, then submit again.',
  },
  {
    label: 'Age requirement',
    text: 'We could not confirm that you meet the minimum age requirement for this register - please check your date of birth and ID, and resubmit.',
  },
  {
    label: 'Eligibility',
    text: 'Your application is missing required eligibility information. Please review and complete all mandatory fields, upload clear documents/photos, and submit again.',
  },
];

function idPathLooksLikeImage(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
}

export default function AdminMemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, mfaOk, refresh } = useAdminGuard();
  const [profile, setProfile] = useState<MemberProfileFull | null>(null);
  const [priv, setPriv] = useState<MemberPrivateFull | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingRecord, setEditingRecord] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [checklist, setChecklist] = useState([false, false, false, false]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** Pre-signed ID document URL from server (short-lived); refreshed on each detail load. */
  const [idDocSignedFromServer, setIdDocSignedFromServer] = useState<string | null>(null);
  const [supportOnly, setSupportOnly] = useState(false);
  const [internalNoteDraft, setInternalNoteDraft] = useState('');
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [recentEmails, setRecentEmails] = useState<
    { id: string; email_type: string; subject: string | null; sent_at: string; status: string }[]
  >([]);
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);
  const [toolsBusy, setToolsBusy] = useState<string | null>(null);
  const [unrejectBusy, setUnrejectBusy] = useState(false);
  const [adminPhotoMode, setAdminPhotoMode] = useState<'direct' | 'pending_review'>('direct');
  const [adminPhotoBusy, setAdminPhotoBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setSupportOnly(isSupportAdmin(data.user));
    });
  }, []);

  useEffect(() => {
    if (!id || ok !== true || mfaOk !== true) return;
    void (async () => {
      setDetailError(null);
      try {
        const res = (await invokeFunction('admin-manage-users', {
          action: 'get_member_detail',
          profile_id: id,
        })) as {
          profile?: MemberProfileFull;
          member_private?: MemberPrivateFull;
          timeline?: TimelineRow[];
          signed_urls?: { photo: string | null; pending_photo: string | null; id_document: string | null };
          admin_note?: { body: string; updated_at: string | null; updated_by: string | null };
          recent_emails?: typeof recentEmails;
        };
        if (!res.profile || !res.member_private) {
          setDetailError('Member not found or incomplete data.');
          setProfile(null);
          setPriv(null);
          return;
        }
        setProfile(res.profile);
        setPriv(res.member_private);
        setTimeline(res.timeline ?? []);
        const su = res.signed_urls;
        setPhotoUrl(su?.photo ?? null);
        setPendingPreview(su?.pending_photo ?? null);
        setIdDocSignedFromServer(su?.id_document ?? null);
        setInternalNoteDraft(res.admin_note?.body ?? '');
        setRecentEmails(res.recent_emails ?? []);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Failed to load member');
        setProfile(null);
        setPriv(null);
      }
    })();
  }, [id, ok, mfaOk, reloadKey]);

  if (ok === false) return <Navigate to="/dashboard/browse" replace />;
  if (ok === null || mfaOk === null) {
    return <div className="layout-max">Loading…</div>;
  }
  if (!mfaOk) return <MfaEnroll onDone={() => void refresh()} />;
  if (detailError && !profile) {
    return (
      <div className="layout-max">
        <p style={{ color: 'var(--color-danger)' }}>{detailError}</p>
        <Link to="/admin/members">← Members</Link>
      </div>
    );
  }
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
        <p style={{ marginTop: 12 }}>
          {!supportOnly && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditingRecord((v) => !v)}
            >
              {editingRecord ? 'Close editor' : 'Edit full record'}
            </button>
          )}
          {supportOnly && (
            <span className="field-hint" style={{ display: 'block', marginTop: 4 }}>
              Support role: full record editing is disabled. You can still use notes, resend emails, and export below.
            </span>
          )}
        </p>

        {profile.status === 'rejected' && !supportOnly && (
          <div
            className="card"
            style={{
              marginTop: 20,
              borderLeft: '4px solid var(--color-success, #15803d)',
              background: 'linear-gradient(90deg, rgba(21, 128, 61, 0.06), transparent)',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>Rejected application</h2>
            <p style={{ marginBottom: 14, color: 'var(--color-text-secondary)' }}>
              Put them back in the approval queue in one step (clears the rejection reason). Use the full editor only if
              you still need to change fields.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'var(--color-success, #15803d)' }}
              disabled={unrejectBusy}
              onClick={async () => {
                if (
                  !window.confirm(
                    'Return this applicant to pending approval? They will appear in the pending list again for review.'
                  )
                ) {
                  return;
                }
                setUnrejectBusy(true);
                try {
                  await invokeFunction('admin-manage-users', {
                    action: 'update_member_record',
                    profile_id: profile.id,
                    edit_note: 'Returned to pending approval (quick unreject)',
                    profile: { status: 'pending_approval', rejection_reason: null },
                  });
                  setEditingRecord(false);
                  setReloadKey((k) => k + 1);
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed to unreject');
                } finally {
                  setUnrejectBusy(false);
                }
              }}
            >
              {unrejectBusy ? 'Saving…' : 'Return to review queue'}
            </button>
          </div>
        )}

        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Staff internal note</h3>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Visible only in admin; not shown to the member.
          </p>
          <textarea
            value={internalNoteDraft}
            onChange={(e) => setInternalNoteDraft(e.target.value)}
            rows={5}
            style={{ width: '100%', maxWidth: 560 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            disabled={internalNoteSaving}
            onClick={async () => {
              setInternalNoteSaving(true);
              try {
                await invokeFunction('admin-manage-users', {
                  action: 'set_internal_note',
                  profile_id: profile.id,
                  note: internalNoteDraft,
                });
                setReloadKey((k) => k + 1);
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Failed to save note');
              } finally {
                setInternalNoteSaving(false);
              }
            }}
          >
            {internalNoteSaving ? 'Saving…' : 'Save internal note'}
          </button>
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Member tools</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <span className="label" style={{ marginRight: 4 }}>
              Resend email
            </span>
            <select
              id="resend-template"
              defaultValue=""
              style={{ maxWidth: 280 }}
              disabled={!!toolsBusy}
            >
              <option value="">Choose template…</option>
              <option value="admin_pending_reminder">Pending reminder</option>
              <option value="registration_received">Registration received</option>
              <option value="registration_approved">Registration approved</option>
              <option value="registration_rejected">Registration rejected (uses saved reason)</option>
              <option value="renewal_reminder">Renewal reminder (30d)</option>
              <option value="membership_expired">Membership expired</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!toolsBusy}
              onClick={async () => {
                const sel = document.getElementById('resend-template') as HTMLSelectElement;
                const template = sel?.value;
                if (!template) {
                  alert('Pick a template first');
                  return;
                }
                setToolsBusy('resend');
                try {
                  await invokeFunction('admin-manage-users', {
                    action: 'resend_member_email',
                    profile_id: profile.id,
                    template,
                  });
                  alert('Email sent.');
                  setReloadKey((k) => k + 1);
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setToolsBusy(null);
                }
              }}
            >
              Send
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!toolsBusy}
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify({ profile, member_private: priv, exported_at: new Date().toISOString() }, null, 2)],
                  { type: 'application/json' }
                );
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `member-${profile.reference_number ?? profile.id}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Export JSON
            </button>
          </div>
          {!supportOnly && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!toolsBusy || !priv.id_document_url}
                onClick={async () => {
                  if (!window.confirm('Delete the ID file from storage and clear the path? This cannot be undone.')) {
                    return;
                  }
                  setToolsBusy('purge');
                  try {
                    await invokeFunction('admin-manage-users', {
                      action: 'purge_id_document',
                      profile_id: profile.id,
                    });
                    setReloadKey((k) => k + 1);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  } finally {
                    setToolsBusy(null);
                  }
                }}
              >
                Purge ID document
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!toolsBusy}
                onClick={async () => {
                  setToolsBusy('magic');
                  try {
                    const res = (await invokeFunction('admin-manage-users', {
                      action: 'generate_member_magic_link',
                      profile_id: profile.id,
                    })) as { action_link?: string };
                    if (res.action_link) setMagicLinkUrl(res.action_link);
                    else alert('No link returned');
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  } finally {
                    setToolsBusy(null);
                  }
                }}
              >
                Generate sign-in link
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!toolsBusy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Invalidate all sessions for this member? They will need to sign in again (brief account lock is used server-side).'
                    )
                  ) {
                    return;
                  }
                  setToolsBusy('sessions');
                  try {
                    await invokeFunction('admin-manage-users', {
                      action: 'revoke_member_sessions',
                      profile_id: profile.id,
                    });
                    alert('Sessions revoked.');
                    setReloadKey((k) => k + 1);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  } finally {
                    setToolsBusy(null);
                  }
                }}
              >
                Revoke all sessions
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!toolsBusy}
                onClick={async () => {
                  if (!window.confirm('Send a password recovery email to this member?')) return;
                  setToolsBusy('recovery');
                  try {
                    await invokeFunction('admin-manage-users', {
                      action: 'send_password_recovery_for_member',
                      profile_id: profile.id,
                    });
                    alert('Recovery email triggered.');
                    setReloadKey((k) => k + 1);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  } finally {
                    setToolsBusy(null);
                  }
                }}
              >
                Send password recovery
              </button>
            </div>
          )}
          {magicLinkUrl && (
            <div className="card" style={{ marginTop: 12, background: '#f8f4ff' }}>
              <p style={{ marginTop: 0, fontSize: 14 }}>
                <strong>One-time link</strong> (do not share outside staff). Opens in a new tab.
              </p>
              <input readOnly value={magicLinkUrl} style={{ width: '100%', fontSize: 12 }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => window.open(magicLinkUrl, '_blank', 'noopener,noreferrer')}
                >
                  Open
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setMagicLinkUrl(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {recentEmails.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Recent emails (this profile)</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {recentEmails.map((r) => (
                <li key={r.id} style={{ marginBottom: 6 }}>
                  <strong>{r.email_type}</strong> · {r.status} · {new Date(r.sent_at).toLocaleString('en-GB')}
                  {r.subject && <span style={{ color: 'var(--color-text-secondary)' }}> - {r.subject}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {editingRecord && (
          <div className="card" style={{ marginTop: 20 }}>
            <AdminMemberEditForm
              profile={profile}
              priv={priv}
              onSaved={() => {
                setEditingRecord(false);
                setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditingRecord(false)}
            />
          </div>
        )}

        {pending && supportOnly && (
          <p className="card" style={{ marginBottom: 16, background: '#f6f4e8' }}>
            Support role: you cannot approve or reject from this page. Use <strong>Members</strong> bulk reminder or
            resend email tools if appropriate, or ask a super admin.
          </p>
        )}

        {canMarkMatched && !supportOnly && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Membership status</h3>
            <button type="button" className="btn btn-primary" onClick={() => setMatchOpen(true)}>
              Mark as matched…
            </button>
          </div>
        )}

        <div className="admin-detail-photo-grid" style={{ marginTop: 24 }}>
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
            {priv.id_document_url ? (
              idDocSignedFromServer ? (
                idPathLooksLikeImage(priv.id_document_url) ? (
                  <img
                    src={idDocSignedFromServer}
                    alt={`${profile.first_name}'s proof of identity`}
                    style={{ width: '100%', maxWidth: 320, borderRadius: 8, display: 'block' }}
                  />
                ) : (
                  <p style={{ margin: 0 }}>
                    <a
                      href={idDocSignedFromServer}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary"
                    >
                      Open ID document (legacy file)
                    </a>
                  </p>
                )
              ) : (
                <p style={{ color: 'var(--color-danger)', margin: 0 }}>
                  Could not load ID preview. Refresh the page.
                </p>
              )
            ) : (
              <p style={{ color: 'var(--color-text-secondary)' }}>No ID on file.</p>
            )}
          </div>
        </div>

        {!supportOnly && (
          <div className="card" style={{ marginTop: 24 }}>
            <h3 style={{ marginTop: 0 }}>Replace profile photo</h3>
            <p className="field-hint" style={{ marginTop: -6 }}>
              JPG or PNG. The image is compressed in the browser, then uploaded to their storage folder (same layout as
              self‑service uploads).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxWidth: 420 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="adminPhotoMode"
                  checked={adminPhotoMode === 'direct'}
                  onChange={() => setAdminPhotoMode('direct')}
                />
                <span>
                  <strong>Publish now</strong> - replace main photo and mark approved (use when you trust this image).
                </span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="adminPhotoMode"
                  checked={adminPhotoMode === 'pending_review'}
                  onChange={() => setAdminPhotoMode('pending_review')}
                />
                <span>
                  <strong>Pending review</strong> - same as a member upload; use &quot;Pending photo review&quot; below
                  to approve or reject.
                </span>
              </label>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <input
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                disabled={adminPhotoBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void (async () => {
                    const bad = rejectReasonIfNotJpegOrPng(file);
                    if (bad) {
                      alert(bad);
                      e.target.value = '';
                      return;
                    }
                    setAdminPhotoBusy(true);
                    try {
                      const compressed = await imageCompression(file, {
                        maxSizeMB: 0.25,
                        maxWidthOrHeight: 1200,
                        useWebWorker: true,
                      });
                      const dataUrl = await new Promise<string>((resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(r.result as string);
                        r.onerror = () => reject(new Error('Could not read file'));
                        r.readAsDataURL(compressed);
                      });
                      await invokeFunction('admin-manage-users', {
                        action: 'admin_upload_member_photo',
                        profile_id: profile.id,
                        mode: adminPhotoMode === 'pending_review' ? 'pending_review' : 'direct',
                        image_base64: dataUrl,
                      });
                      setReloadKey((k) => k + 1);
                      e.target.value = '';
                      alert(
                        adminPhotoMode === 'direct'
                          ? 'Photo published as their main profile image.'
                          : 'Photo saved as pending - approve or reject in the section below when ready.'
                      );
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Upload failed');
                    } finally {
                      setAdminPhotoBusy(false);
                    }
                  })();
                }}
              />
              {adminPhotoBusy && <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>Uploading…</span>}
            </div>
          </div>
        )}

        {pending && !supportOnly && (
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
              {confirmApprove ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 14 }}>Confirm approval?</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ background: 'var(--color-success)' }}
                    onClick={async () => {
                      try {
                        await invokeFunction('admin-approve-member', { profile_id: profile.id });
                        navigate('/admin/members');
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Failed');
                      }
                    }}
                  >
                    Yes, approve
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmApprove(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: 'var(--color-success)' }}
                  disabled={!checklist.every(Boolean)}
                  onClick={() => setConfirmApprove(true)}
                >
                  Approve
                </button>
              )}
            </div>
            <div style={{ marginTop: 24 }}>
              <label className="label">Reject reason</label>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Quick templates (click to add - you can edit the text below):
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {REJECTION_REASON_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 13, padding: '6px 10px' }}
                    onClick={() => {
                      setRejectReason((prev) => {
                        const p = prev.trim();
                        if (!p) return t.text;
                        if (p.includes(t.text.slice(0, 40))) return p;
                        return `${p}\n\n${t.text}`;
                      });
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={6} />
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

        {!pending && profile.pending_photo_url && !supportOnly && (
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Pending photo review</h3>
            {pendingPreview && (
              <img
                src={pendingPreview}
                alt={`${profile.first_name}'s pending profile photo`}
                style={{ width: '100%', maxWidth: 320, borderRadius: 8, marginBottom: 12 }}
              />
            )}
            <div className="admin-inline-btn-row" style={{ marginTop: 0 }}>
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
          </div>
        )}

        {!editingRecord && (
          <div className="card prose-safe" style={{ marginTop: 24 }}>
            <h3>Private details</h3>
            <p>
              Email: {priv.email}
              <br />
              Mobile: {priv.mobile_phone}
              <br />
              DOB: {priv.date_of_birth}
              <br />
              Coupon used: {priv.coupon_used ?? '-'}
            </p>
          </div>
        )}

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
                    {row.admin_email ?? '-'}
                  </p>
                  {row.notes && (
                    <p style={{ margin: '8px 0 0', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {row.notes.length > 2000 && row.action_type === 'profile_admin_edit' ? (
                        <>
                          {row.notes.slice(0, 2000)}
                          <span style={{ color: 'var(--color-text-secondary)' }}> … (truncated in UI)</span>
                        </>
                      ) : (
                        row.notes
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card" style={{ marginTop: 24 }}>
          <h3>Account status</h3>
          {profile.status !== 'archived' && !supportOnly && (
            <div>
              {!confirmArchive ? (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmArchive(true)}>
                  Archive member
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: 'var(--color-danger)' }}>
                    Archive this member? They will be hidden from the register.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ background: 'var(--color-danger)' }}
                    onClick={async () => {
                      try {
                        await invokeFunction('admin-update-member-status', {
                          profile_id: profile.id,
                          action: 'archive',
                        });
                        navigate('/admin/members');
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Failed');
                      }
                    }}
                  >
                    Confirm archive
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmArchive(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          {profile.status === 'archived' && !supportOnly && (
            <div>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
                This member is archived. Reinstating will set status to active and extend membership by 1 year.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await invokeFunction('admin-update-member-status', {
                      profile_id: profile.id,
                      action: 'reinstate',
                    });
                    navigate('/admin/members');
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed');
                  }
                }}
              >
                Reinstate member
              </button>
            </div>
          )}
          {profile.status === 'archived' && supportOnly && (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 0 }}>
              This member is archived (reinstate requires a super admin).
            </p>
          )}
          {supportOnly && profile.status !== 'archived' && (
            <p className="field-hint" style={{ marginBottom: 0 }}>
              Support role cannot archive or mark matched from this screen.
            </p>
          )}
        </div>

        {matchOpen && !supportOnly && (
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
              <div className="modal-actions">
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
