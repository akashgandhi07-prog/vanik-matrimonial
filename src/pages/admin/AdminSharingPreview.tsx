import { useEffect, useMemo, useState } from 'react';
import { ProfileModal } from '../../member/ProfileModal';
import type { ProfileRow } from '../../member/memberContext';
import { invokeFunction } from '../../lib/supabase';

type PickerProfile = {
  id: string;
  first_name: string;
  full_name?: string;
  gender: string;
  age: number | null;
  reference_number: string | null;
  status: string;
};

type SharedContact = Record<string, string>;

type PreviewResponse = {
  requester: { profile: ProfileRow; shared_contact: SharedContact };
  candidate: { profile: ProfileRow; shared_contact: SharedContact };
  emails: {
    contact_details: { subject: string; html: string };
    introduction_received: { subject: string; html: string };
  };
};

/** Human labels for contact payload keys; unknown keys fall back to the raw key so new fields surface automatically. */
const CONTACT_LABELS: Record<string, string> = {
  first_name: 'First name',
  full_name: 'Full name (incl. surname)',
  reference_number: 'Reference number',
  mobile: 'Mobile number',
  email: 'Email address',
};

function ContactTable({ contact }: { contact: SharedContact }) {
  const entries = Object.entries(contact).filter(([k]) => k !== 'profile_id');
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%', maxWidth: 460 }}>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <th
              scope="row"
              style={{
                textAlign: 'left',
                padding: '6px 16px 6px 0',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
              }}
            >
              {CONTACT_LABELS[key] ?? key}
            </th>
            <td style={{ padding: '6px 0' }}>{value || <em style={{ color: 'var(--color-text-secondary)' }}>not held</em>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmailPreview({ subject, html }: { subject: string; html: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden', maxWidth: 640 }}>
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 13,
          background: 'var(--color-surface, rgba(0,0,0,0.03))',
        }}
      >
        <strong>Subject:</strong> {subject}
      </div>
      <iframe
        title={subject}
        sandbox=""
        srcDoc={html}
        style={{ width: '100%', height: 420, border: 'none', display: 'block', background: '#f5f1ea' }}
      />
    </div>
  );
}

function StageCard({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>{intro}</p>
      </div>
      {children}
    </section>
  );
}

export default function AdminSharingPreview() {
  const [members, setMembers] = useState<PickerProfile[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [openModal, setOpenModal] = useState<null | 'browse' | 'candidate_full' | 'requester_full'>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await invokeFunction('admin-manage-users', {
          action: 'list_profiles',
          filter: 'all',
        })) as { profiles?: PickerProfile[] };
        if (!cancelled) {
          const rows = [...(res.profiles ?? [])];
          rows.sort((x, y) => (x.full_name ?? x.first_name).localeCompare(y.full_name ?? y.first_name));
          setMembers(rows);
        }
      } catch (e) {
        if (!cancelled) setMembersError(e instanceof Error ? e.message : 'Could not load members');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setOpenModal(null);
    if (!aId || !bId || aId === bId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = (await invokeFunction('admin-sharing-preview', {
          requester_id: aId,
          candidate_id: bId,
        })) as PreviewResponse;
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the preview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aId, bId]);

  const optionLabel = (m: PickerProfile) => {
    const bits = [m.full_name ?? m.first_name, m.gender, m.age != null ? `age ${m.age}` : null, m.reference_number, m.status]
      .filter(Boolean)
      .join(' · ');
    return bits;
  };

  const aName = useMemo(() => members.find((m) => m.id === aId)?.first_name ?? 'Member A', [members, aId]);
  const bName = useMemo(() => members.find((m) => m.id === bId)?.first_name ?? 'Member B', [members, bId]);
  const noop = () => undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: '0 0 8px' }}>Sharing preview</h1>
        <p style={{ margin: 0, maxWidth: 720, fontSize: 15, lineHeight: 1.55 }}>
          Pick two members to see exactly what each one learns about the other when <strong>A requests B&apos;s
          contact details</strong>. There is no accept step: a request is an immediate two-way introduction. This page
          is generated by the same code that runs real introductions, so it always shows the current behaviour.
        </p>
        <p
          style={{
            margin: '10px 0 0',
            maxWidth: 720,
            fontSize: 13,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          Read-only: nothing here sends an email, creates a request, uses anyone&apos;s weekly quota, or is visible to
          the two members.
        </p>
      </div>

      <div className="card" style={{ padding: 20, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
          Member A (makes the request)
          <select value={aId} onChange={(e) => setAId(e.target.value)} style={{ minWidth: 280, padding: 8 }}>
            <option value="">Choose a member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} disabled={m.id === bId}>
                {optionLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
          Member B (is requested)
          <select value={bId} onChange={(e) => setBId(e.target.value)} style={{ minWidth: 280, padding: 8 }}>
            <option value="">Choose a member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} disabled={m.id === aId}>
                {optionLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!aId || !bId}
          onClick={() => {
            setAId(bId);
            setBId(aId);
          }}
        >
          Swap A and B
        </button>
      </div>

      {membersError && <p style={{ color: 'var(--color-danger)' }}>{membersError}</p>}
      {loading && <p style={{ color: 'var(--color-text-secondary)' }}>Building the preview…</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {data && (
        <>
          <StageCard
            title={`Stage 1 - Before any request: ${bName} in ${aName}'s Browse`}
            intro={`While ${aName} is only browsing, ${bName} appears without name, surname, photo, or any contact details. Only the profile facts below the fold are visible (age, gender, profession, religion, location, diet, height, education, settlement plans, hobbies).`}
          >
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal('browse')}>
                Open {bName}&apos;s browse card exactly as {aName} sees it
              </button>
            </div>
          </StageCard>

          <StageCard
            title={`Stage 2 - ${aName} requests ${bName}'s details`}
            intro={`The moment the request is submitted, ${aName} receives these fields about ${bName} - in the app under My requests, and by email. ${bName} does not approve or decline this.`}
          >
            <ContactTable contact={data.candidate.shared_contact} />
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal('candidate_full')}>
                Open {bName}&apos;s full card (with photo) as {aName} now sees it
              </button>
            </div>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Email sent to {aName}</h3>
              <EmailPreview subject={data.emails.contact_details.subject} html={data.emails.contact_details.html} />
            </div>
          </StageCard>

          <StageCard
            title={`Stage 3 - What ${bName} gets in return`}
            intro={`The introduction is mutual. ${bName} is emailed ${aName}'s name and age, and when ${bName} signs in, the "Requested your details" tab shows ${aName}'s full profile, photos, and the contact details below.`}
          >
            <ContactTable contact={data.requester.shared_contact} />
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setOpenModal('requester_full')}>
                Open {aName}&apos;s full card (with photo) as {bName} sees it
              </button>
            </div>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Email sent to {bName}</h3>
              <EmailPreview
                subject={data.emails.introduction_received.subject}
                html={data.emails.introduction_received.html}
              />
            </div>
          </StageCard>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 720 }}>
            Not shared at any stage: date of birth (only age), home address, ID documents, payment details, and any
            feedback either member writes about an introduction.
          </p>

          {openModal === 'browse' && (
            <ProfileModal
              candidate={data.candidate.profile}
              anonymous
              inTray={false}
              trayFull={false}
              blocked={false}
              bookmarked={false}
              allowRequestAction={false}
              showRequestFromBrowseHint={false}
              onClose={() => setOpenModal(null)}
              onToggleBookmark={noop}
              onToggleTray={noop}
            />
          )}
          {openModal === 'candidate_full' && (
            <ProfileModal
              candidate={data.candidate.profile}
              contactDetails={data.candidate.shared_contact.mobile ? { mobile: data.candidate.shared_contact.mobile } : undefined}
              inTray={false}
              trayFull={false}
              blocked={false}
              bookmarked={false}
              allowRequestAction={false}
              showRequestFromBrowseHint={false}
              onClose={() => setOpenModal(null)}
              onToggleBookmark={noop}
              onToggleTray={noop}
            />
          )}
          {openModal === 'requester_full' && (
            <ProfileModal
              candidate={data.requester.profile}
              contactDetails={data.requester.shared_contact.mobile ? { mobile: data.requester.shared_contact.mobile } : undefined}
              inTray={false}
              trayFull={false}
              blocked={false}
              bookmarked={false}
              allowRequestAction={false}
              showRequestFromBrowseHint={false}
              onClose={() => setOpenModal(null)}
              onToggleBookmark={noop}
              onToggleTray={noop}
            />
          )}
        </>
      )}
    </div>
  );
}
