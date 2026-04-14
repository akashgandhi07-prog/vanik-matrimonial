import { useMemo, useState } from 'react';
import { ProfileThumb } from '../member/ProfileThumb';
import { ProfileModal } from '../member/ProfileModal';
import { useMemberArea } from '../member/memberContext';
import type { ProfileRow } from '../member/memberContext';
import { cmToFeetInches } from '../lib/heights';
import { invokeFunction } from '../lib/supabase';

export default function MemberBrowse() {
  const { profile, candidates, bookmarks, toggleBookmark, requests, loadAll, privateRow } =
    useMemberArea();
  const [ageRange, setAgeRange] = useState<[number, number]>([18, 70]);
  const [dietF, setDietF] = useState<string[]>([]);
  const [religionF, setReligionF] = useState<string[]>([]);
  const [communityF, setCommunityF] = useState<string[]>([]);
  const [heightRange, setHeightRange] = useState<[number, number]>([142, 198]);
  const [sort, setSort] = useState<'newest' | 'youngest' | 'oldest'>('newest');
  const [tray, setTray] = useState<string[]>([]);
  const [trayDrawerOpen, setTrayDrawerOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState<
    | null
    | { contacts: Array<Record<string, string>>; email: string }
  >(null);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);
  const [submitError, setSubmitError] = useState<{ type: 'weekly_limit' | 'feedback_required' | 'generic'; message: string; requestIds?: string[] } | null>(null);

  const filtered = useMemo(() => {
    if (!profile) return [];
    let rows = candidates.filter((c) => {
      const age = c.age ?? 0;
      if (age < ageRange[0] || age > ageRange[1]) return false;
      if (dietF.length && c.diet && !dietF.includes(c.diet)) return false;
      if (religionF.length && c.religion && !religionF.includes(c.religion)) return false;
      if (communityF.length && c.community && !communityF.includes(c.community)) return false;
      const h = c.height_cm ?? 0;
      if (h && (h < heightRange[0] || h > heightRange[1])) return false;
      return true;
    });
    if (sort === 'newest') {
      rows = [...rows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else if (sort === 'youngest') {
      rows = [...rows].sort((a, b) => (a.age ?? 999) - (b.age ?? 999));
    } else {
      rows = [...rows].sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    }
    return rows;
  }, [profile, candidates, ageRange, dietF, religionF, communityF, heightRange, sort]);

  const recentlyRequestedCandidateIds = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- time-based eligibility window for contact requests
    const cutoff = Date.now() - 180 * 86400000;
    const ids = new Set<string>();
    for (const r of requests) {
      if (new Date(r.created_at).getTime() <= cutoff) continue;
      for (const cid of (r.candidate_ids as string[]) ?? []) ids.add(cid);
    }
    return ids;
  }, [requests]);

  const trayFull = tray.length >= 3;

  if (!profile) return null;

  function addTray(id: string) {
    if (tray.includes(id)) {
      setTray((t) => t.filter((x) => x !== id));
      return;
    }
    if (trayFull) return;
    setTray((t) => [...t, id]);
  }

  async function submitTray() {
    if (!profile || tray.length === 0) return;
    setSubmitError(null);
    try {
      const res = (await invokeFunction('submit-contact-request', {
        candidate_ids: tray,
      })) as {
        contacts?: Array<Record<string, string>>;
        requester_email?: string;
        error?: string;
        message?: string;
        request_ids?: string[];
      };
      setTray([]);
      setTrayDrawerOpen(false);
      setContactsOpen({
        contacts: res.contacts ?? [],
        email: res.requester_email ?? privateRow?.email ?? '',
      });
      void loadAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      // Parse structured errors from the edge function
      if (msg.includes('weekly_limit') || msg.includes('Weekly limit')) {
        setSubmitError({ type: 'weekly_limit', message: msg });
      } else if (msg.includes('feedback_required') || msg.includes('Outstanding feedback')) {
        setSubmitError({ type: 'feedback_required', message: msg });
      } else {
        setSubmitError({ type: 'generic', message: msg });
      }
    }
  }

  const trayPaddingBottom = tray.length > 0 ? 'var(--member-tray-height, 100px)' : undefined;

  return (
    <div style={{ paddingBottom: trayPaddingBottom }}>
      <div className="member-browse-layout">
        <aside className="card member-browse-filters" style={{ position: 'sticky', top: 16 }}>
          <h3 style={{ marginTop: 0 }}>Filters</h3>
          <div style={{ marginBottom: 12 }}>
            <label className="label" htmlFor="browse-age-min">
              Age range (min)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                id="browse-age-min"
                type="number"
                min={18}
                max={80}
                value={ageRange[0]}
                onChange={(e) => setAgeRange([Number(e.target.value), ageRange[1]])}
                style={{ width: 72 }}
                aria-label="Minimum age"
              />
              <span aria-hidden="true">to</span>
              <label htmlFor="browse-age-max" className="visually-hidden">
                Maximum age
              </label>
              <input
                id="browse-age-max"
                type="number"
                min={18}
                max={80}
                value={ageRange[1]}
                onChange={(e) => setAgeRange([ageRange[0], Number(e.target.value)])}
                style={{ width: 72 }}
                aria-label="Maximum age"
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span className="label" id="browse-height-label">
              Height (cm)
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                value={heightRange[0]}
                onChange={(e) => setHeightRange([Number(e.target.value), heightRange[1]])}
                style={{ width: 80 }}
                aria-labelledby="browse-height-label"
                aria-label="Minimum height in cm"
              />
              <span aria-hidden="true">to</span>
              <input
                type="number"
                value={heightRange[1]}
                onChange={(e) => setHeightRange([heightRange[0], Number(e.target.value)])}
                style={{ width: 80 }}
                aria-labelledby="browse-height-label"
                aria-label="Maximum height in cm"
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              {cmToFeetInches(heightRange[0])} to {cmToFeetInches(heightRange[1])}
            </p>
          </div>
          {(
            [
              ['diet', ['Veg', 'Non-veg', 'Vegan'], dietF, setDietF],
              ['religion', ['Jain', 'Hindu', 'Other'], religionF, setReligionF],
              ['community', ['Vanik', 'Lohana', 'Brahmin', 'Other'], communityF, setCommunityF],
            ] as const
          ).map(([label, opts, state, setState]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <span className="label">{label}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {opts.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className="badge badge-muted"
                    style={{
                      cursor: 'pointer',
                      border: state.includes(o) ? '1px solid var(--color-primary)' : undefined,
                    }}
                    onClick={() =>
                      setState(state.includes(o) ? state.filter((x) => x !== o) : [...state, o])
                    }
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div>
            <label className="label" htmlFor="browse-sort">
              Sort
            </label>
            <select
              id="browse-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="newest">Newest first</option>
              <option value="youngest">Youngest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </aside>
        <section className="member-browse-grid">
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {filtered.length === 0
              ? 'No profiles match your filters.'
              : `${filtered.length} profile${filtered.length === 1 ? '' : 's'}`}
            {trayFull && (
              <span style={{ marginLeft: 16, color: 'var(--color-warning)', fontWeight: 500 }}>
                Tray full (3/3). Submit or remove one before adding another.
              </span>
            )}
          </div>
          <div className="member-browse-cards">
            {filtered.length === 0 && (
              <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                <p style={{ margin: 0, fontWeight: 500 }}>No profiles found</p>
                <p style={{ margin: '8px 0 0', fontSize: 14 }}>
                  Try adjusting your filters to see more results.
                </p>
              </div>
            )}
            {filtered.map((c) => {
              const inTray = tray.includes(c.id);
              const blocked = recentlyRequestedCandidateIds.has(c.id);
              return (
                <div
                  key={c.id}
                  className="card"
                  style={{ padding: 0, position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
                  onClick={() => setSelectedProfile(c)}
                >
                  <span
                    className="badge badge-muted"
                    style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, background: 'rgba(255,255,255,0.9)', fontSize: 11 }}
                  >
                    {c.reference_number}
                  </span>
                  <ProfileThumb profileId={c.id} firstName={c.first_name} />
                  <div style={{ padding: '12px 14px 14px' }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
                      {c.first_name}{c.age ? `, ${c.age}` : ''}
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {[c.job_title, cmToFeetInches(c.height_cm), c.diet].filter(Boolean).join(' · ')}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {[c.religion, c.community, c.nationality].filter(Boolean).join(' · ')}
                    </p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ flex: 1, padding: '7px 10px', fontSize: 13 }}
                        onClick={(e) => { e.stopPropagation(); void toggleBookmark(c.id); }}
                      >
                        {bookmarks.includes(c.id) ? '★ Saved' : '☆ Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '7px 10px', fontSize: 13 }}
                        disabled={blocked || (!inTray && trayFull)}
                        onClick={(e) => { e.stopPropagation(); addTray(c.id); }}
                      >
                        {blocked ? '✓ Requested' : inTray ? '✕ Remove' : '+ Request'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {tray.length > 0 && (
        <div className="member-request-tray">
          <button
            type="button"
            className="btn btn-secondary member-tray-toggle"
            aria-expanded={trayDrawerOpen}
            aria-controls="member-tray-panel"
            onClick={() => setTrayDrawerOpen((o) => !o)}
          >
            {tray.length}/3 selected{trayDrawerOpen ? ' - hide' : ' - show'}
          </button>
          <div
            id="member-tray-panel"
            className={`member-tray-panel ${trayDrawerOpen ? 'member-tray-panel--open' : ''}`}
          >
            <div className="member-tray-chips">
              {tray.map((id) => {
                const c = candidates.find((x) => x.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="badge badge-muted"
                    style={{ cursor: 'pointer', border: '1px solid var(--color-border)' }}
                    title={`Remove ${c?.first_name ?? 'this candidate'}`}
                    onClick={() => addTray(id)}
                  >
                    {c?.first_name ?? '…'} ✕
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void submitTray()}>
              Request contact details ({tray.length})
            </button>
            {submitError && (
              <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: submitError.type === 'feedback_required' ? 'rgba(217,119,6,0.12)' : 'rgba(220,38,38,0.08)',
                color: submitError.type === 'feedback_required' ? 'var(--color-warning)' : 'var(--color-danger)',
                border: `1px solid ${submitError.type === 'feedback_required' ? 'rgba(217,119,6,0.3)' : 'rgba(220,38,38,0.2)'}` }}>
                {submitError.type === 'feedback_required' && (
                  <><strong>Feedback required before new requests.</strong> Please visit{' '}
                    <a href="/dashboard/requests" style={{ color: 'inherit', fontWeight: 600 }}>My requests</a> to submit outstanding feedback.</>
                )}
                {submitError.type === 'weekly_limit' && (
                  <><strong>Weekly limit reached.</strong> {submitError.message.replace('Weekly limit reached (3 candidates). ', '')}</>
                )}
                {submitError.type === 'generic' && submitError.message}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedProfile && (
        <ProfileModal
          candidate={selectedProfile}
          inTray={tray.includes(selectedProfile.id)}
          trayFull={trayFull}
          blocked={recentlyRequestedCandidateIds.has(selectedProfile.id)}
          bookmarked={bookmarks.includes(selectedProfile.id)}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.id)}
          onToggleTray={() => addTray(selectedProfile.id)}
        />
      )}

      {contactsOpen && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="contacts-dialog-title"
          className="modal-backdrop"
          onClick={() => setContactsOpen(null)}
        >
          <div className="card modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2 id="contacts-dialog-title" style={{ marginTop: 0 }}>
              Contact details
            </h2>
            {contactsOpen.contacts.map((c) => (
              <div
                key={c.profile_id}
                style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}
              >
                <p style={{ margin: 0 }}>
                  <strong>{c.full_name}</strong> ({c.reference_number})
                </p>
                <p style={{ margin: '8px 0 0', fontSize: 14 }}>
                  Phone: {c.mobile}
                  <br />
                  Email: {c.email}
                  <br />
                  Father: {c.father_name}
                  <br />
                  Mother: {c.mother_name}
                </p>
              </div>
            ))}
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
              A copy of these details has also been sent to your email at {contactsOpen.email}.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setContactsOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
