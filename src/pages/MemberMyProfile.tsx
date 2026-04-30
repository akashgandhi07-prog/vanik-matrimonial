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
  const [preview, setPreview] = useState<string | null>(null);
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

  async function newPhoto(file: File) {
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
      setPreview(URL.createObjectURL(compressed));
      const path = `${p.gender}/${uid}/photo-pending.jpg`;
      const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, compressed, {
        upsert: true,
      });
      if (upErr) {
        setPhotoError(upErr.message);
        return;
      }
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ pending_photo_url: path, photo_status: 'pending' })
        .eq('id', p.id);
      if (dbErr) {
        setPhotoError(dbErr.message);
        return;
      }
      void loadAll();
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
          New photos require admin approval before they replace your current picture.
        </p>
        {(p.pending_photo_url || p.photo_status === 'pending') && (
          <p className="badge badge-warning" style={{ marginBottom: 8 }}>
            Your new photo is awaiting admin review. Your current approved photo remains visible where applicable.
          </p>
        )}
        <label className="label" htmlFor="mp-photo-file">
          Upload new photo (JPG or PNG only)
        </label>
        <input
          id="mp-photo-file"
          type="file"
          accept="image/jpeg,image/png"
          disabled={photoSaving}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void newPhoto(f);
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
        {preview && (
          <img
            src={preview}
            alt="Preview of your selected photo"
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, marginTop: 8 }}
          />
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
