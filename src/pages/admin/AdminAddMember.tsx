import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HEIGHT_OPTIONS } from '../../lib/heights';
import { invokeFunction } from '../../lib/supabase';

const defaultExpiry = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
})();

type FormState = {
  first_name: string;
  surname: string;
  email: string;
  mobile_phone: string;
  date_of_birth: string;
  gender: string;
  community: string;
  religion: string;
  nationality: string;
  place_of_birth: string;
  town_country_of_origin: string;
  education: string;
  job_title: string;
  height_cm: string;
  diet: string;
  hobbies: string;
  future_settlement_plans: string;
  father_name: string;
  mother_name: string;
  home_address_line1: string;
  city: string;
  postcode: string;
  country: string;
  status: 'active' | 'pending_approval';
  membership_expires_at: string;
  show_on_register: boolean;
};

const INIT: FormState = {
  first_name: '',
  surname: '',
  email: '',
  mobile_phone: '',
  date_of_birth: '',
  gender: 'Male',
  community: '',
  religion: '',
  nationality: '',
  place_of_birth: '',
  town_country_of_origin: '',
  education: '',
  job_title: '',
  height_cm: '',
  diet: '',
  hobbies: '',
  future_settlement_plans: '',
  father_name: '',
  mother_name: '',
  home_address_line1: '',
  city: '',
  postcode: '',
  country: 'UK',
  status: 'active',
  membership_expires_at: defaultExpiry,
  show_on_register: true,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

export default function AdminAddMember() {
  const [form, setForm] = useState<FormState>(INIT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name.trim()) { setError('First name is required'); return; }
    if (!form.email.trim()) { setError('Email is required'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const result = await invokeFunction('admin-add-member', {
        ...form,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        membership_expires_at: form.membership_expires_at
          ? new Date(form.membership_expires_at).toISOString()
          : null,
      });
      const profileId = result.profile_id as string | undefined;
      if (profileId) {
        void navigate(`/admin/members/${profileId}`);
      } else {
        void navigate('/admin/members');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Add member</h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        Manually add a member (e.g. migrating from spreadsheet). A random password will be set. The
        member should use "forgot password" to set their own.
      </p>

      <div className="card" style={{ maxWidth: 620 }}>
        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0 }}>Personal details</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="First name *">
              <input
                required
                value={form.first_name}
                onChange={(e) => set('first_name', e.target.value)}
              />
            </Field>
            <Field label="Surname">
              <input value={form.surname} onChange={(e) => set('surname', e.target.value)} />
            </Field>
          </div>

          <Field label="Email *">
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>

          <Field label="Mobile phone">
            <input value={form.mobile_phone} onChange={(e) => set('mobile_phone', e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Date of birth">
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
              />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </Field>
          </div>

          <h2 style={{ margin: 0, marginTop: 8 }}>Background</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Community">
              <input value={form.community} onChange={(e) => set('community', e.target.value)} />
            </Field>
            <Field label="Religion">
              <input value={form.religion} onChange={(e) => set('religion', e.target.value)} />
            </Field>
            <Field label="Nationality">
              <input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
            </Field>
            <Field label="Place of birth">
              <input value={form.place_of_birth} onChange={(e) => set('place_of_birth', e.target.value)} />
            </Field>
            <Field label="Town / country of origin">
              <input value={form.town_country_of_origin} onChange={(e) => set('town_country_of_origin', e.target.value)} />
            </Field>
          </div>

          <h2 style={{ margin: 0, marginTop: 8 }}>Professional &amp; lifestyle</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Education">
              <input value={form.education} onChange={(e) => set('education', e.target.value)} />
            </Field>
            <Field label="Job title">
              <input value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
            </Field>
            <Field label="Height">
              <select
                value={form.height_cm}
                onChange={(e) => set('height_cm', e.target.value)}
              >
                <option value="">Select height</option>
                {HEIGHT_OPTIONS.map((h) => (
                  <option key={h.cm} value={String(h.cm)}>
                    {h.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Diet">
              <input value={form.diet} onChange={(e) => set('diet', e.target.value)} />
            </Field>
          </div>

          <Field label="Hobbies">
            <textarea
              rows={2}
              value={form.hobbies}
              onChange={(e) => set('hobbies', e.target.value)}
            />
          </Field>

          <Field label="Future settlement plans">
            <input
              value={form.future_settlement_plans}
              onChange={(e) => set('future_settlement_plans', e.target.value)}
            />
          </Field>

          <h2 style={{ margin: 0, marginTop: 8 }}>Family</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Father's name">
              <input value={form.father_name} onChange={(e) => set('father_name', e.target.value)} />
            </Field>
            <Field label="Mother's name">
              <input value={form.mother_name} onChange={(e) => set('mother_name', e.target.value)} />
            </Field>
          </div>

          <h2 style={{ margin: 0, marginTop: 8 }}>Address</h2>

          <Field label="Address line 1">
            <input
              value={form.home_address_line1}
              onChange={(e) => set('home_address_line1', e.target.value)}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="Postcode">
              <input value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
            </Field>
            <Field label="Country">
              <input value={form.country} onChange={(e) => set('country', e.target.value)} />
            </Field>
          </div>

          <h2 style={{ margin: 0, marginTop: 8 }}>Membership</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value as FormState['status'])}
              >
                <option value="active">active</option>
                <option value="pending_approval">pending_approval</option>
              </select>
            </Field>
            <Field label="Membership expires at">
              <input
                type="date"
                value={form.membership_expires_at}
                onChange={(e) => set('membership_expires_at', e.target.value)}
              />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.show_on_register}
              onChange={(e) => set('show_on_register', e.target.checked)}
            />
            Show on register
          </label>

          {error && <p style={{ color: 'var(--color-danger)', margin: 0 }}>{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding member…' : 'Add member'}
          </button>
        </form>
      </div>
    </div>
  );
}
