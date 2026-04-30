import { useEffect, useMemo, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { ProfileThumb } from '../member/ProfileThumb';
import type { MemberPrivateRow, ProfileRow } from '../member/memberContext';
import { useMemberArea } from '../member/memberContext';
import { cmToFeetInches, HEIGHT_OPTIONS } from '../lib/heights';
import { rejectReasonIfNotJpegOrPng } from '../lib/profilePhotoAccept';
import { sanitizeText } from '../lib/sanitize';
import { isValidPlaceField } from '../lib/registerValidation';
import { invokeFunction, supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
const DIET_OPTIONS = ['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'] as const;

type FormProps = {
  profile: ProfileRow;
  privateRow: MemberPrivateRow;
  loadAll: () => Promise<void>;
};

type ProfilePhoto = {
  id: string;
  storage_path: string;
  position: number;
  is_primary: boolean;
  signed_url: string | null;
};

function MemberMyProfileForm({ profile: p, loadAll }: FormProps) {
  const navigate = useNavigate();
  const [education, setEducation] = useState(p.education ?? '');
  const [jobTitle, setJobTitle] = useState(p.job_title ?? '');
  const [hobbies, setHobbies] = useState(p.hobbies ?? '');
  const [future, setFuture] = useState(p.future_settlement_plans ?? '');
  const [nationality, setNationality] = useState(p.nationality ?? '');
  const [town, setTown] = useState(p.town_country_of_origin ?? '');
  const [height, setHeight] = useState<number | ''>(p.height_cm ?? '');
  const [diet, setDiet] = useState(p.diet ?? 'Veg');
  const [pwNew, setPwNew] = useState('');
  const [pwConf, setPwConf] = useState('');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pwError, setPwError] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');
  const [delError, setDelError] = useState('');
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [dragPhotoIndex, setDragPhotoIndex] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [seeking, setSeeking] = useState<'Male' | 'Female' | 'Both'>(() =>
    p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female')
  );

  useEffect(() => {
    setSeeking(p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female'));
  }, [p.seeking_gender, p.gender, p.id]);

  const heightCm = height === '' ? null : Number(height);
  const initialHeight = p.height_cm == null ? '' : Number(p.height_cm);
  const hasUnsavedChanges = useMemo(() => {
    return (
      education !== (p.education ?? '') ||
      jobTitle !== (p.job_title ?? '') ||
      hobbies !== (p.hobbies ?? '') ||
      future !== (p.future_settlement_plans ?? '') ||
      nationality !== (p.nationality ?? '') ||
      town !== (p.town_country_of_origin ?? '') ||
      height !== initialHeight ||
      diet !== (p.diet ?? 'Veg') ||
      seeking !== (p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female'))
    );
  }, [
    education,
    jobTitle,
    hobbies,
    future,
    nationality,
    town,
    height,
    initialHeight,
    diet,
    seeking,
    p.education,
    p.job_title,
    p.hobbies,
    p.future_settlement_plans,
    p.nationality,
    p.town_country_of_origin,
    p.diet,
    p.seeking_gender,
    p.gender,
  ]);

  async function saveField() {
    if (!hasUnsavedChanges) return;
    const nextErrors: Record<string, string> = {};
    if (!education.trim() || education.trim().length < 3) {
      nextErrors.education = 'Enter at least 3 characters for education.';
    }
    if (!jobTitle.trim()) {
      nextErrors.jobTitle = 'Job title is required.';
    }
    if (!hobbies.trim() || hobbies.trim().length < 3) {
      nextErrors.hobbies = 'Add at least a short hobbies description.';
    }
    if (future.trim().length > 200) {
      nextErrors.future = 'Future settlement plans must be 200 characters or less.';
    }
    if (!isValidPlaceField(nationality, 100)) {
      nextErrors.nationality = 'Enter your nationality (at least 2 characters).';
    }
    if (!isValidPlaceField(town, 200)) {
      nextErrors.town = 'Enter town and country of origin.';
    }
    if (height === '') {
      nextErrors.height = 'Please select your height.';
    }
    if (!DIET_OPTIONS.includes(diet as (typeof DIET_OPTIONS)[number])) {
      nextErrors.diet = 'Please choose a valid diet option.';
    }
    if (!['Male', 'Female', 'Both'].includes(seeking)) {
      nextErrors.seeking = 'Please choose who you want to browse.';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveStatus('error');
      setSaveError('Please correct the highlighted fields and save again.');
      return;
    }
    setSaveStatus('saving');
    setSaveError('');
    const { error } = await supabase
      .from('profiles')
      .update({
        education: sanitizeText(education, 500),
        job_title: sanitizeText(jobTitle, 200),
        hobbies: sanitizeText(hobbies, 400),
        future_settlement_plans: sanitizeText(future, 200),
        nationality: sanitizeText(nationality, 100),
        town_country_of_origin: sanitizeText(town, 200),
        height_cm: height === '' ? null : Number(height),
        diet,
        seeking_gender: seeking,
      })
      .eq('id', p.id);
    if (error) {
      setSaveStatus('error');
      setSaveError(error.message);
    } else {
      setSaveStatus('saved');
      void loadAll();
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (pwNew.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (pwNew !== pwConf) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwStatus('saving');
    const { error } = await supabase.auth.updateUser({ password: pwNew });
    if (error) {
      setPwStatus('error');
      setPwError(error.message);
      return;
    }
    setPwStatus('saved');
    setPwNew('');
    setPwConf('');
    // Sign out after password change for security
    setTimeout(async () => {
      await supabase.auth.signOut();
      navigate('/login?reset=1');
    }, 1500);
  }

  async function loadPhotos() {
    const data = (await invokeFunction('member-manage-photos', { action: 'list' })) as {
      photos?: Array<{ id: string; storage_path: string; position: number; is_primary: boolean }>;
    };
    const rows = [...(data.photos ?? [])].sort((a, b) => a.position - b.position);
    const signed = await Promise.all(
      rows.map(async (row) => {
        const { data: signedData } = await supabase.storage.from('profile-photos').createSignedUrl(row.storage_path, 3600);
        return {
          ...row,
          signed_url: signedData?.signedUrl ?? null,
        };
      })
    );
    setPhotos(signed);
  }

  useEffect(() => {
    void loadPhotos();
  }, [p.id]);

  async function newPhoto(file: File) {
    if (photos.length >= 3) {
      setPhotoError('Maximum 3 photos allowed.');
      return;
    }
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return;
    const reject = rejectReasonIfNotJpegOrPng(file);
    if (reject) {
      setPhotoError(reject);
      return;
    }
    setPhotoSaving(true);
    setPhotoError('');
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      });
      const ext = compressed.type === 'image/png' ? 'png' : 'jpg';
      const path = `${p.gender}/${uid}/photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, compressed, {
        upsert: true,
        contentType: compressed.type || 'image/jpeg',
      });
      if (upErr) {
        setPhotoError(upErr.message);
        return;
      }
      await invokeFunction('member-manage-photos', { action: 'add', storage_path: path });
      await loadPhotos();
      void loadAll();
    } finally {
      setPhotoSaving(false);
    }
  }

  async function removePhoto(photoId: string) {
    setPhotoSaving(true);
    setPhotoError('');
    try {
      await invokeFunction('member-manage-photos', { action: 'remove', photo_id: photoId });
      await loadPhotos();
      void loadAll();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not remove photo.');
    } finally {
      setPhotoSaving(false);
    }
  }

  async function setPrimary(photoId: string) {
    setPhotoSaving(true);
    setPhotoError('');
    try {
      await invokeFunction('member-manage-photos', { action: 'set_primary', photo_id: photoId });
      await loadPhotos();
      void loadAll();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not set primary photo.');
    } finally {
      setPhotoSaving(false);
    }
  }

  async function movePhoto(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return;
    setPhotoSaving(true);
    setPhotoError('');
    try {
      await invokeFunction('member-manage-photos', { action: 'reorder', from_index: from, to_index: to });
      await loadPhotos();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not reorder photos.');
    } finally {
      setPhotoSaving(false);
    }
  }

  return (
    <div className="member-my-profile-grid">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>How others see you</h3>
        <ProfileThumb profileId={p.id} firstName={p.first_name} />
        <p style={{ marginTop: 12 }}>
          {p.first_name}, {p.age}
        </p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Edit profile</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Changes save when you click &quot;Save changes&quot;. These fields do not require admin approval.
        </p>
        <div
          className="member-form-actions"
          style={{
            position: 'sticky',
            top: 8,
            zIndex: 5,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 10,
            margin: '0 0 10px',
          }}
        >
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveStatus === 'saving' || !hasUnsavedChanges}
            onClick={() => void saveField()}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
          {saveStatus === 'saved' && (
            <span style={{ color: 'var(--color-success)', fontSize: 14 }}>✓ Saved</span>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: 'var(--color-danger)', fontSize: 14 }}>
              Failed to save{saveError ? `: ${saveError}` : ''}
            </span>
          )}
          {saveStatus !== 'saving' && hasUnsavedChanges && (
            <span style={{ color: 'var(--color-warning)', fontSize: 13 }}>Unsaved changes</span>
          )}
          {saveStatus !== 'saving' && !hasUnsavedChanges && saveStatus !== 'saved' && (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>No pending changes</span>
          )}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label className="label" htmlFor="mp-seeking">
              I want to browse profiles of
            </label>
            <select id="mp-seeking" value={seeking} onChange={(e) => setSeeking(e.target.value as typeof seeking)}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Both">Both</option>
            </select>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Who you can see and request contact details for. Save to apply.
            </p>
            {fieldErrors.seeking && <p className="field-error">{fieldErrors.seeking}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-education">
              Education
            </label>
            <textarea
              id="mp-education"
              value={education}
              onChange={(e) => setEducation(e.target.value)}
            />
            {fieldErrors.education && <p className="field-error">{fieldErrors.education}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-job">
              Job title
            </label>
            <input id="mp-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            {fieldErrors.jobTitle && <p className="field-error">{fieldErrors.jobTitle}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-hobbies">
              Hobbies
            </label>
            <textarea
              id="mp-hobbies"
              value={hobbies}
              onChange={(e) => setHobbies(e.target.value)}
              maxLength={400}
            />
            {fieldErrors.hobbies && <p className="field-error">{fieldErrors.hobbies}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-future">
              Future settlement plans
            </label>
            <textarea
              id="mp-future"
              value={future}
              onChange={(e) => setFuture(e.target.value)}
              maxLength={200}
            />
            {fieldErrors.future && <p className="field-error">{fieldErrors.future}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-nationality">
              Nationality
            </label>
            <input id="mp-nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} />
            {fieldErrors.nationality && <p className="field-error">{fieldErrors.nationality}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-town">
              Town / country of origin
            </label>
            <input id="mp-town" value={town} onChange={(e) => setTown(e.target.value)} />
            {fieldErrors.town && <p className="field-error">{fieldErrors.town}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-height">
              Height{heightCm != null && !Number.isNaN(heightCm) ? ` (${cmToFeetInches(heightCm)})` : ''}
            </label>
            <select
              id="mp-height"
              value={height === '' ? '' : String(height)}
              onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select…</option>
              {HEIGHT_OPTIONS.map((h) => (
                <option key={h.cm} value={h.cm}>
                  {h.label}
                </option>
              ))}
            </select>
            {fieldErrors.height && <p className="field-error">{fieldErrors.height}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mp-diet">
              Diet
            </label>
            <select id="mp-diet" value={diet} onChange={(e) => setDiet(e.target.value)}>
              {DIET_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {fieldErrors.diet && <p className="field-error">{fieldErrors.diet}</p>}
          </div>
          <div className="member-form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveStatus === 'saving' || !hasUnsavedChanges}
              onClick={() => void saveField()}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
            {saveStatus === 'saved' && (
              <span style={{ color: 'var(--color-success)', fontSize: 14 }}>✓ Saved</span>
            )}
            {saveStatus === 'error' && (
              <span style={{ color: 'var(--color-danger)', fontSize: 14 }}>
                Failed to save{saveError ? `: ${saveError}` : ''}
              </span>
            )}
            {saveStatus !== 'saving' && hasUnsavedChanges && (
              <span style={{ color: 'var(--color-warning)', fontSize: 13 }}>Unsaved changes</span>
            )}
          </div>
        </div>

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

        <h3>Profile photo</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Upload up to 3 photos. Drag and drop to reorder, and set any photo as your profile picture.
        </p>
        <label className="label" htmlFor="mp-photo-file">
          Upload photo (JPG or PNG only)
        </label>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 8px' }}>
          Use a clear photo of your face only. Group photos are not accepted.
        </p>
        <input
          id="mp-photo-file"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          disabled={photoSaving}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.slice(0, 3).forEach((f) => void newPhoto(f));
            e.currentTarget.value = '';
          }}
        />
        {photoSaving && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Uploading and compressing photo…
          </p>
        )}
        {photoError && (
          <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: '4px 0 0' }}>{photoError}</p>
        )}
        {photos.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            {photos.map((photo, idx) => (
              <div
                key={photo.id}
                draggable
                onDragStart={() => setDragPhotoIndex(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragPhotoIndex != null) void movePhoto(dragPhotoIndex, idx);
                  setDragPhotoIndex(null);
                }}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  border: photo.is_primary ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                {photo.signed_url ? (
                  <img
                    src={photo.signed_url}
                    alt={`Profile photo ${idx + 1}`}
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }}
                  />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 6, background: 'var(--color-surface-muted)' }} />
                )}
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {photo.is_primary ? 'Primary profile photo' : `Photo ${idx + 1}`}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>Drag to reorder</p>
                </div>
                {!photo.is_primary && (
                  <button type="button" className="btn btn-secondary" disabled={photoSaving} onClick={() => void setPrimary(photo.id)}>
                    Set primary
                  </button>
                )}
                <button type="button" className="btn btn-secondary" disabled={photoSaving} onClick={() => void removePhoto(photo.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

        <h3>Password</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
          For security, you&apos;ll be signed out after changing your password.
        </p>
        <form onSubmit={(e) => void changePassword(e)} style={{ display: 'grid', gap: 8 }}>
          <label className="label" htmlFor="mp-pw-new">
            New password
          </label>
          <input
            id="mp-pw-new"
            type="password"
            autoComplete="new-password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            minLength={8}
            disabled={pwStatus === 'saving' || pwStatus === 'saved'}
          />
          <label className="label" htmlFor="mp-pw-conf">
            Confirm new password
          </label>
          <input
            id="mp-pw-conf"
            type="password"
            autoComplete="new-password"
            value={pwConf}
            onChange={(e) => setPwConf(e.target.value)}
            minLength={8}
            disabled={pwStatus === 'saving' || pwStatus === 'saved'}
          />
          <div className="member-form-actions">
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={pwStatus === 'saving' || pwStatus === 'saved'}
            >
              {pwStatus === 'saving' ? 'Updating…' : 'Update password'}
            </button>
            {pwStatus === 'saved' && (
              <span style={{ color: 'var(--color-success)', fontSize: 14 }}>
                ✓ Password updated. Signing you out…
              </span>
            )}
          </div>
          {pwError && (
            <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{pwError}</p>
          )}
        </form>

        <p style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDelOpen(true)}>
            Request account deletion
          </button>
        </p>
      </div>

      {delOpen && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="del-dialog-title"
          className="modal-backdrop"
          onClick={() => setDelOpen(false)}
        >
          <div className="card modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3 id="del-dialog-title">Confirm deletion</h3>
            <p>
              This will permanently archive your profile and hide it from the register. Type{' '}
              <strong>DELETE</strong> to confirm.
            </p>
            <label className="label" htmlFor="mp-del-confirm">
              Confirmation
            </label>
            <input
              id="mp-del-confirm"
              value={delConfirm}
              onChange={(e) => setDelConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDelOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--color-danger)' }}
                onClick={async () => {
                  if (delConfirm !== 'DELETE') return;
                  try {
                    setDelError('');
                    await invokeFunction('request-account-deletion', {});
                    setDelOpen(false);
                    await supabase.auth.signOut();
                    window.location.href = '/';
                  } catch (err) {
                    setDelError(err instanceof Error ? err.message : 'Failed');
                  }
                }}
              >
                Confirm
              </button>
            </div>
            {delError && (
              <p role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--color-danger)' }}>
                {delError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MemberMyProfile() {
  const { profile, privateRow, loadAll, loading } = useMemberArea();
  if (loading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        Loading your profile…
      </div>
    );
  }
  if (!profile || !privateRow) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Could not load your profile</h3>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          We could not load your member profile right now. Try again in a moment.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <MemberMyProfileForm
      key={`${profile.id}-${profile.updated_at}`}
      profile={profile}
      privateRow={privateRow}
      loadAll={loadAll}
    />
  );
}
