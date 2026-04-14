import { useState } from 'react';
import imageCompression from 'browser-image-compression';
import { ProfileThumb } from '../member/ProfileThumb';
import type { MemberPrivateRow, ProfileRow } from '../member/memberContext';
import { useMemberArea } from '../member/memberContext';
import { cmToFeetInches, HEIGHT_OPTIONS } from '../lib/heights';
import { sanitizeText } from '../lib/sanitize';
import { userFacingAuthError } from '../lib/auth';
import { invokeFunction, supabase } from '../lib/supabase';

type FormProps = {
  profile: ProfileRow;
  privateRow: MemberPrivateRow;
  loadAll: () => Promise<void>;
};

function MemberMyProfileForm({ profile: p, privateRow: pr, loadAll }: FormProps) {
  const [education, setEducation] = useState(p.education ?? '');
  const [jobTitle, setJobTitle] = useState(p.job_title ?? '');
  const [hobbies, setHobbies] = useState(p.hobbies ?? '');
  const [future, setFuture] = useState(p.future_settlement_plans ?? '');
  const [nationality, setNationality] = useState(p.nationality ?? '');
  const [town, setTown] = useState(p.town_country_of_origin ?? '');
  const [height, setHeight] = useState<number | ''>(p.height_cm ?? '');
  const [weight, setWeight] = useState(p.weight_kg != null ? String(p.weight_kg) : '');
  const [diet, setDiet] = useState(p.diet ?? 'Veg');
  const [pwCur, setPwCur] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConf, setPwConf] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const heightCm = height === '' ? null : Number(height);

  async function saveField() {
    await supabase
      .from('profiles')
      .update({
        education: sanitizeText(education, 500),
        job_title: sanitizeText(jobTitle, 200),
        hobbies: sanitizeText(hobbies, 400),
        future_settlement_plans: sanitizeText(future, 200),
        nationality: sanitizeText(nationality, 100),
        town_country_of_origin: sanitizeText(town, 200),
        height_cm: height === '' ? null : Number(height),
        weight_kg: weight ? Number(weight) : null,
        diet,
      })
      .eq('id', p.id);
    void loadAll();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwNew.length < 8 || pwNew !== pwConf) {
      alert('Check new password');
      return;
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: pr.email,
      password: pwCur,
    });
    if (signErr) {
      alert(userFacingAuthError(signErr, 'reauth_current_password'));
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pwNew });
    if (error) alert(userFacingAuthError(error));
    else alert('Password updated');
    setPwCur('');
    setPwNew('');
    setPwConf('');
  }

  async function newPhoto(file: File) {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return;
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
      alert(upErr.message);
      return;
    }
    await supabase
      .from('profiles')
      .update({ pending_photo_url: path, photo_status: 'pending' })
      .eq('id', p.id);
    void loadAll();
  }

  return (
    <div className="member-my-profile-grid">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>How others see you</h3>
        <ProfileThumb profileId={p.id} firstName={p.first_name} />
        <p style={{ marginTop: 12 }}>
          {p.first_name}, {p.age}
        </p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{p.reference_number}</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Edit profile</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Changes save when you click &quot;Save changes&quot;. These fields do not require admin approval.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label className="label" htmlFor="mp-education">
              Education
            </label>
            <textarea
              id="mp-education"
              value={education}
              onChange={(e) => setEducation(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="mp-job">
              Job title
            </label>
            <input id="mp-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
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
          </div>
          <div>
            <label className="label" htmlFor="mp-nationality">
              Nationality
            </label>
            <input id="mp-nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="mp-town">
              Town / country of origin
            </label>
            <input id="mp-town" value={town} onChange={(e) => setTown(e.target.value)} />
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
              {HEIGHT_OPTIONS.map((h) => (
                <option key={h.cm} value={h.cm}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="mp-weight">
              Weight (kg)
            </label>
            <input
              id="mp-weight"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              min={30}
              max={200}
            />
          </div>
          <div>
            <label className="label" htmlFor="mp-diet">
              Diet
            </label>
            <select id="mp-diet" value={diet} onChange={(e) => setDiet(e.target.value)}>
              {['Veg', 'Non-veg', 'Vegan'].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void saveField()}>
            Save changes
          </button>
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
          Upload new photo (JPEG or PNG)
        </label>
        <input
          id="mp-photo-file"
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void newPhoto(f);
          }}
        />
        {preview && (
          <img
            src={preview}
            alt="Preview of your selected photo"
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, marginTop: 8 }}
          />
        )}

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

        <h3>Password</h3>
        <form onSubmit={changePassword} style={{ display: 'grid', gap: 8 }}>
          <label className="label" htmlFor="mp-pw-cur">
            Current password
          </label>
          <input
            id="mp-pw-cur"
            type="password"
            autoComplete="current-password"
            value={pwCur}
            onChange={(e) => setPwCur(e.target.value)}
          />
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
          />
          <button type="submit" className="btn btn-secondary">
            Update password
          </button>
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
                    await invokeFunction('request-account-deletion', {});
                    setDelOpen(false);
                    await supabase.auth.signOut();
                    window.location.href = '/';
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Failed');
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

export default function MemberMyProfile() {
  const { profile, privateRow, loadAll } = useMemberArea();
  if (!profile || !privateRow) return null;
  return (
    <MemberMyProfileForm
      key={`${profile.id}-${profile.updated_at}`}
      profile={profile}
      privateRow={privateRow}
      loadAll={loadAll}
    />
  );
}
