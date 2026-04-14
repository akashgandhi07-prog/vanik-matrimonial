import { useCallback, useEffect, useState } from 'react';
import { HEIGHT_OPTIONS } from '../../lib/heights';
import { invokeFunction } from '../../lib/supabase';

export type MemberProfileFull = {
  id: string;
  reference_number: string | null;
  gender: string;
  first_name: string;
  age: number | null;
  education: string | null;
  job_title: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  diet: string | null;
  religion: string | null;
  community: string | null;
  nationality: string | null;
  place_of_birth: string | null;
  town_country_of_origin: string | null;
  future_settlement_plans: string | null;
  hobbies: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
  status: string;
  show_on_register: boolean;
  membership_expires_at: string | null;
  last_request_at: string | null;
  rejection_reason: string | null;
  auth_user_id: string;
};

export type MemberPrivateFull = {
  surname: string;
  email: string;
  mobile_phone: string;
  date_of_birth: string;
  home_address_line1: string | null;
  home_address_city: string | null;
  home_address_postcode: string | null;
  home_address_country: string | null;
  father_name: string | null;
  mother_name: string | null;
  id_document_url: string | null;
  coupon_used: string | null;
};

function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type Props = {
  profile: MemberProfileFull;
  priv: MemberPrivateFull;
  onSaved: () => void;
  onCancel: () => void;
};

export function AdminMemberEditForm({ profile, priv, onSaved, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');

  const [gender, setGender] = useState(profile.gender);
  const [firstName, setFirstName] = useState(profile.first_name);
  const [education, setEducation] = useState(profile.education ?? '');
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? '');
  const [heightCm, setHeightCm] = useState<string>(profile.height_cm != null ? String(profile.height_cm) : '');
  const [weightKg, setWeightKg] = useState<string>(profile.weight_kg != null ? String(profile.weight_kg) : '');
  const [diet, setDiet] = useState(profile.diet ?? 'Veg');
  const [religion, setReligion] = useState(profile.religion ?? '');
  const [community, setCommunity] = useState(profile.community ?? '');
  const [nationality, setNationality] = useState(profile.nationality ?? '');
  const [placeOfBirth, setPlaceOfBirth] = useState(profile.place_of_birth ?? '');
  const [townOrigin, setTownOrigin] = useState(profile.town_country_of_origin ?? '');
  const [settlement, setSettlement] = useState(profile.future_settlement_plans ?? '');
  const [hobbies, setHobbies] = useState(profile.hobbies ?? '');
  const [photoUrl, setPhotoUrl] = useState(profile.photo_url ?? '');
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState(profile.pending_photo_url ?? '');
  const [photoStatus, setPhotoStatus] = useState(profile.photo_status);
  const [status, setStatus] = useState(profile.status);
  const [showOnRegister, setShowOnRegister] = useState(profile.show_on_register);
  const [rejectionReason, setRejectionReason] = useState(profile.rejection_reason ?? '');
  const [membershipExpires, setMembershipExpires] = useState(isoToDatetimeLocal(profile.membership_expires_at));
  const [lastRequest, setLastRequest] = useState(isoToDatetimeLocal(profile.last_request_at));

  const [surname, setSurname] = useState(priv.surname);
  const [dob, setDob] = useState(priv.date_of_birth?.slice(0, 10) ?? '');
  const [email, setEmail] = useState(priv.email);
  const [mobile, setMobile] = useState(priv.mobile_phone);
  const [addr1, setAddr1] = useState(priv.home_address_line1 ?? '');
  const [city, setCity] = useState(priv.home_address_city ?? '');
  const [postcode, setPostcode] = useState(priv.home_address_postcode ?? '');
  const [country, setCountry] = useState(priv.home_address_country ?? 'UK');
  const [fatherName, setFatherName] = useState(priv.father_name ?? '');
  const [motherName, setMotherName] = useState(priv.mother_name ?? '');
  const [idDocPath, setIdDocPath] = useState(priv.id_document_url ?? '');
  const [couponUsed, setCouponUsed] = useState(priv.coupon_used ?? '');

  const resetFromProps = useCallback(() => {
    setGender(profile.gender);
    setFirstName(profile.first_name);
    setEducation(profile.education ?? '');
    setJobTitle(profile.job_title ?? '');
    setHeightCm(profile.height_cm != null ? String(profile.height_cm) : '');
    setWeightKg(profile.weight_kg != null ? String(profile.weight_kg) : '');
    setDiet(profile.diet ?? 'Veg');
    setReligion(profile.religion ?? '');
    setCommunity(profile.community ?? '');
    setNationality(profile.nationality ?? '');
    setPlaceOfBirth(profile.place_of_birth ?? '');
    setTownOrigin(profile.town_country_of_origin ?? '');
    setSettlement(profile.future_settlement_plans ?? '');
    setHobbies(profile.hobbies ?? '');
    setPhotoUrl(profile.photo_url ?? '');
    setPendingPhotoUrl(profile.pending_photo_url ?? '');
    setPhotoStatus(profile.photo_status);
    setStatus(profile.status);
    setShowOnRegister(profile.show_on_register);
    setRejectionReason(profile.rejection_reason ?? '');
    setMembershipExpires(isoToDatetimeLocal(profile.membership_expires_at));
    setLastRequest(isoToDatetimeLocal(profile.last_request_at));
    setSurname(priv.surname);
    setDob(priv.date_of_birth?.slice(0, 10) ?? '');
    setEmail(priv.email);
    setMobile(priv.mobile_phone);
    setAddr1(priv.home_address_line1 ?? '');
    setCity(priv.home_address_city ?? '');
    setPostcode(priv.home_address_postcode ?? '');
    setCountry(priv.home_address_country ?? 'UK');
    setFatherName(priv.father_name ?? '');
    setMotherName(priv.mother_name ?? '');
    setIdDocPath(priv.id_document_url ?? '');
    setCouponUsed(priv.coupon_used ?? '');
    setErr(null);
    setEditNote('');
  }, [profile, priv]);

  useEffect(() => {
    resetFromProps();
  }, [resetFromProps]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const heightParsed = heightCm.trim() === '' ? null : Math.floor(Number(heightCm));
      const weightParsed = weightKg.trim() === '' ? null : Math.floor(Number(weightKg));
      await invokeFunction('admin-manage-users', {
        action: 'update_member_record',
        profile_id: profile.id,
        edit_note: editNote.trim() || undefined,
        profile: {
          gender,
          first_name: firstName,
          education,
          job_title: jobTitle,
          height_cm: heightParsed,
          weight_kg: weightParsed,
          diet,
          religion,
          community,
          nationality,
          place_of_birth: placeOfBirth,
          town_country_of_origin: townOrigin,
          future_settlement_plans: settlement,
          hobbies,
          photo_url: photoUrl.trim() || null,
          pending_photo_url: pendingPhotoUrl.trim() || null,
          photo_status: photoStatus,
          status,
          show_on_register: showOnRegister,
          rejection_reason: status === 'rejected' ? rejectionReason : null,
          membership_expires_at: datetimeLocalToIso(membershipExpires),
          last_request_at: datetimeLocalToIso(lastRequest),
        },
        member_private: {
          surname,
          date_of_birth: dob,
          email,
          mobile_phone: mobile,
          home_address_line1: addr1,
          home_address_city: city,
          home_address_postcode: postcode,
          home_address_country: country,
          father_name: fatherName,
          mother_name: motherName,
          id_document_url: idDocPath.trim() || null,
          coupon_used: couponUsed.trim() || null,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Edit member record</h3>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Full manual control — use carefully. Changing <strong>email</strong> updates their login address too.
        Storage paths (<code>photo_url</code>, ID) must match objects in Supabase Storage if you edit them
        manually.
      </p>
      {profile.status === 'rejected' && (
        <p className="badge badge-warning" style={{ display: 'block', marginBottom: 12 }}>
          Rejected — fix fields below, then set <strong>Status</strong> to &quot;pending_approval&quot; to send
          them back into the review queue (rejection reason is cleared automatically for pending).
        </p>
      )}
      {err && (
        <p style={{ color: 'var(--color-danger)', marginBottom: 12 }} role="alert">
          {err}
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          gap: 12,
        }}
      >
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Reference (read-only)</label>
          <input value={profile.reference_number ?? '—'} readOnly style={{ opacity: 0.85 }} />
        </div>

        <div>
          <label className="label">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {[
              'pending_approval',
              'active',
              'rejected',
              'expired',
              'archived',
              'matched',
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showOnRegister}
              onChange={(e) => setShowOnRegister(e.target.checked)}
            />
            Show on register
          </label>
        </div>

        <div>
          <label className="label">Gender</label>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div>
          <label className="label">First name</label>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className="label">Surname</label>
          <input value={surname} onChange={(e) => setSurname(e.target.value)} />
        </div>
        <div>
          <label className="label">Date of birth</label>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        <div>
          <label className="label">Email (login)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="label">Mobile</label>
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Address line 1</label>
          <input value={addr1} onChange={(e) => setAddr1(e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="label">Postcode</label>
          <input value={postcode} onChange={(e) => setPostcode(e.target.value)} />
        </div>
        <div>
          <label className="label">Country</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>

        <div>
          <label className="label">Nationality</label>
          <input value={nationality} onChange={(e) => setNationality(e.target.value)} />
        </div>
        <div>
          <label className="label">Place of birth</label>
          <input value={placeOfBirth} onChange={(e) => setPlaceOfBirth(e.target.value)} />
        </div>
        <div>
          <label className="label">Town / country of origin</label>
          <input value={townOrigin} onChange={(e) => setTownOrigin(e.target.value)} />
        </div>
        <div>
          <label className="label">Community</label>
          <select value={community} onChange={(e) => setCommunity(e.target.value)}>
            <option value="">—</option>
            {['Vanik', 'Lohana', 'Brahmin', 'Other'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Religion</label>
          <select value={religion} onChange={(e) => setReligion(e.target.value)}>
            <option value="">—</option>
            {['Jain', 'Hindu', 'Other'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Father&apos;s name</label>
          <input value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
        </div>
        <div>
          <label className="label">Mother&apos;s name</label>
          <input value={motherName} onChange={(e) => setMotherName(e.target.value)} />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Future settlement plans</label>
          <textarea value={settlement} onChange={(e) => setSettlement(e.target.value)} rows={2} maxLength={200} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Education</label>
          <textarea value={education} onChange={(e) => setEducation(e.target.value)} rows={2} />
        </div>
        <div>
          <label className="label">Job title</label>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Height (cm)</label>
          <input
            type="number"
            min={120}
            max={230}
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="e.g. 172"
          />
          <p className="field-hint" style={{ marginBottom: 0 }}>
            Common: {HEIGHT_OPTIONS.find((h) => h.cm === Number(heightCm))?.label ?? '—'}
          </p>
        </div>
        <div>
          <label className="label">Weight (kg)</label>
          <input
            type="number"
            min={0}
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="label">Diet</label>
          <select value={diet} onChange={(e) => setDiet(e.target.value)}>
            {['Veg', 'Non-veg', 'Vegan'].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Hobbies</label>
          <textarea value={hobbies} onChange={(e) => setHobbies(e.target.value)} rows={2} />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Profile photo storage path</label>
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="e.g. Male/uuid/photo.jpg" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Pending photo storage path</label>
          <input
            value={pendingPhotoUrl}
            onChange={(e) => setPendingPhotoUrl(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="label">Photo status</label>
          <select value={photoStatus} onChange={(e) => setPhotoStatus(e.target.value)}>
            {['pending', 'approved', 'rejected'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">ID document storage path</label>
          <input value={idDocPath} onChange={(e) => setIdDocPath(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <label className="label">Coupon used (must exist in DB)</label>
          <input value={couponUsed} onChange={(e) => setCouponUsed(e.target.value.toUpperCase())} />
        </div>

        <div>
          <label className="label">Membership expires</label>
          <input
            type="datetime-local"
            value={membershipExpires}
            onChange={(e) => setMembershipExpires(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Last request (admin)</label>
          <input type="datetime-local" value={lastRequest} onChange={(e) => setLastRequest(e.target.value)} />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Rejection reason (shown when status is rejected)</label>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            rows={3}
            disabled={status !== 'rejected'}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Note for admin timeline (optional)</label>
          <input
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="e.g. Fixed DOB after phone call"
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>
          Cancel edit
        </button>
        {profile.status === 'rejected' && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={() => {
              setStatus('pending_approval');
              setRejectionReason('');
            }}
          >
            Set status → pending approval (unreject)
          </button>
        )}
      </div>
    </div>
  );
}
