import { useMemo, useState } from 'react';
import { ProfileThumb } from '../member/ProfileThumb';
import { ProfileModal } from '../member/ProfileModal';
import { useMemberArea } from '../member/memberContext';
import type { ProfileRow } from '../member/memberContext';
import { cmToFeetInches, HEIGHT_OPTIONS } from '../lib/heights';
import { whatsappUrlFromPhone } from '../lib/whatsapp';
import { invokeFunction, supabase } from '../lib/supabase';

type ContactDetailRow = {
  profile_id: string;
  first_name: string;
  full_name: string;
  reference_number: string;
  mobile: string;
  email: string;
  father_name: string;
  mother_name: string;
};

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : `tel:${encodeURIComponent(phone)}`;
}

const DEFAULT_AGE: [number, number] = [18, 60];
const DEFAULT_HEIGHT: [number, number] = [142, 198];
const DIET_ALL = ['Veg', 'Non-veg', 'Vegan'] as const;
const RELIGION_ALL = ['Jain', 'Hindu', 'Other'] as const;
const COMMUNITY_ALL = ['Vanik', 'Lohana', 'Brahmin', 'Other'] as const;

type BrowseFilters = {
  ageRange: [number, number];
  dietF: string[];
  religionF: string[];
  communityF: string[];
  heightRange: [number, number];
  sort: 'newest' | 'youngest' | 'oldest';
};

function defaultFilters(): BrowseFilters {
  return {
    ageRange: [...DEFAULT_AGE],
    dietF: [...DIET_ALL],
    religionF: [...RELIGION_ALL],
    communityF: [...COMMUNITY_ALL],
    heightRange: [...DEFAULT_HEIGHT],
    sort: 'newest',
  };
}

function cloneFilters(filters: BrowseFilters): BrowseFilters {
  return {
    ageRange: [...filters.ageRange],
    dietF: [...filters.dietF],
    religionF: [...filters.religionF],
    communityF: [...filters.communityF],
    heightRange: [...filters.heightRange],
    sort: filters.sort,
  };
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function filtersEqual(a: BrowseFilters, b: BrowseFilters): boolean {
  return (
    a.ageRange[0] === b.ageRange[0] &&
    a.ageRange[1] === b.ageRange[1] &&
    a.heightRange[0] === b.heightRange[0] &&
    a.heightRange[1] === b.heightRange[1] &&
    sameStringArray(a.dietF, b.dietF) &&
    sameStringArray(a.religionF, b.religionF) &&
    sameStringArray(a.communityF, b.communityF) &&
    a.sort === b.sort
  );
}

function inFilterSet(value: string, allowed: readonly string[]): boolean {
  const v = value.trim().toLowerCase();
  return allowed.some((a) => a.toLowerCase() === v);
}

function effectiveSeeking(p: ProfileRow): 'Male' | 'Female' | 'Both' {
  return p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female');
}

export default function MemberBrowse() {
  const { profile, candidates, bookmarks, toggleBookmark, requests, loadAll } =
    useMemberArea();
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [tray, setTray] = useState<string[]>([]);
  const [trayDrawerOpen, setTrayDrawerOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState<null | { contacts: ContactDetailRow[] }>(
    null
  );
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);
  const [submitError, setSubmitError] = useState<{
    type: 'weekly_limit' | 'feedback_required' | 'already_requested' | 'generic';
    message: string;
    requestIds?: string[];
  } | null>(null);
  const [seekUpdating, setSeekUpdating] = useState(false);

  async function persistSeeking(g: 'Male' | 'Female' | 'Both') {
    if (!profile || effectiveSeeking(profile) === g || seekUpdating) return;
    setSeekUpdating(true);
    try {
      const { error } = await supabase.from('profiles').update({ seeking_gender: g }).eq('id', profile.id);
      if (error) alert(error.message);
      else void loadAll();
    } finally {
      setSeekUpdating(false);
    }
  }

  const filtered = useMemo(() => {
    if (!profile) return [];
    const { ageRange, dietF, religionF, communityF, heightRange, sort } = appliedFilters;
    let rows = candidates.filter((c) => {
      if (c.age != null && (c.age < ageRange[0] || c.age > ageRange[1])) return false;
      if (dietF.length && c.diet && !inFilterSet(c.diet, dietF)) return false;
      if (religionF.length && c.religion && !inFilterSet(c.religion, religionF)) return false;
      if (communityF.length && c.community && !inFilterSet(c.community, communityF)) return false;
      const h = c.height_cm;
      if (h != null && h > 0 && (h < heightRange[0] || h > heightRange[1])) return false;
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
  }, [profile, candidates, appliedFilters]);

  const filtersActive = useMemo(() => {
    const defaults = defaultFilters();
    return (
      !filtersEqual(appliedFilters, defaults)
    );
  }, [appliedFilters]);

  const pendingFilterChanges = useMemo(() => {
    return !filtersEqual(draftFilters, appliedFilters);
  }, [draftFilters, appliedFilters]);

  function clearFilters() {
    const defaults = defaultFilters();
    setDraftFilters(defaults);
    setAppliedFilters(cloneFilters(defaults));
  }

  function applyFilters() {
    setAppliedFilters(cloneFilters(draftFilters));
  }

  const requestedCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) {
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
        error?: string;
        message?: string;
        request_ids?: string[];
      };
      if (res.error) {
        throw new Error(res.message || res.error);
      }
      setTray([]);
      setTrayDrawerOpen(false);
      setContactsOpen({
        contacts: (res.contacts ?? []) as ContactDetailRow[],
      });
      void loadAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      // Parse structured errors from the edge function
      if (msg.includes('weekly_limit') || msg.includes('Weekly limit')) {
        setSubmitError({ type: 'weekly_limit', message: msg });
      } else if (msg.includes('feedback_required') || msg.includes('Outstanding feedback')) {
        setSubmitError({ type: 'feedback_required', message: msg });
      } else if (msg.includes('already_requested_this_week') || msg.includes('already requested this profile')) {
        setSubmitError({ type: 'already_requested', message: msg });
      } else {
        setSubmitError({ type: 'generic', message: msg });
      }
    }
  }

  const trayPaddingBottom = tray.length > 0 ? 'var(--member-tray-height, 100px)' : undefined;

  return (
    <div style={{ paddingBottom: trayPaddingBottom }}>
      <div className="member-browse-filters">
        <div className="member-browse-filters-head">
          <h2 className="member-browse-filters-title">Filters</h2>
          <div className="member-browse-filters-actions">
            <div className="member-browse-filters-sort-wrap">
              <label htmlFor="browse-sort">Sort</label>
              <select
                id="browse-sort"
                className="member-filter-select"
                value={draftFilters.sort}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, sort: e.target.value as BrowseFilters['sort'] }))
                }
              >
                <option value="newest">Newest</option>
                <option value="youngest">Youngest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!pendingFilterChanges}
              onClick={applyFilters}
            >
              Filter
            </button>
            <button
              type="button"
              className="member-filter-clear"
              disabled={!filtersActive}
              onClick={clearFilters}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="member-browse-filters-grid">
          <div className="member-filter-section member-filter-section--full">
            <span id="browse-seeking-label" className="member-filter-section-label">
              Show profiles of
            </span>
            <div
              className="member-filter-chip-row"
              role="group"
              aria-labelledby="browse-seeking-label"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}
            >
              {(['Male', 'Female', 'Both'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={effectiveSeeking(profile) === g ? 'btn btn-primary' : 'btn btn-secondary'}
                  disabled={seekUpdating}
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => void persistSeeking(g)}
                >
                  {g === 'Both' ? 'Everyone' : `${g}s`}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
              Saved on your account. You can also change this under My profile.
            </p>
          </div>
          <div className="member-filter-section">
            <span id="browse-age-label" className="member-filter-section-label">
              Age range
            </span>
            <div className="member-filter-range-row" role="group" aria-labelledby="browse-age-label">
              <input
                type="number"
                className="member-filter-num-input"
                min={18}
                max={80}
                inputMode="numeric"
                value={draftFilters.ageRange[0]}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    ageRange: [Number(e.target.value), prev.ageRange[1]],
                  }))
                }
                aria-label="Minimum age"
              />
              <span className="member-filter-range-to" aria-hidden>
                to
              </span>
              <input
                type="number"
                className="member-filter-num-input"
                min={18}
                max={80}
                inputMode="numeric"
                value={draftFilters.ageRange[1]}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    ageRange: [prev.ageRange[0], Number(e.target.value)],
                  }))
                }
                aria-label="Maximum age"
              />
            </div>
          </div>

          <div className="member-filter-section">
            <span id="browse-height-label" className="member-filter-section-label">
              Height range
            </span>
            <div className="member-filter-range-row" role="group" aria-labelledby="browse-height-label">
              <div className="member-filter-range-field">
                <select
                  className="member-filter-select"
                  value={draftFilters.heightRange[0]}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      heightRange: [Number(e.target.value), prev.heightRange[1]],
                    }))
                  }
                  aria-label="Minimum height"
                >
                  {HEIGHT_OPTIONS.filter((o) => o.cm <= draftFilters.heightRange[1]).map((o) => (
                    <option key={o.cm} value={o.cm}>
                      {cmToFeetInches(o.cm)}
                    </option>
                  ))}
                </select>
              </div>
              <span className="member-filter-range-to" aria-hidden>
                to
              </span>
              <div className="member-filter-range-field">
                <select
                  className="member-filter-select"
                  value={draftFilters.heightRange[1]}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      heightRange: [prev.heightRange[0], Number(e.target.value)],
                    }))
                  }
                  aria-label="Maximum height"
                >
                  {HEIGHT_OPTIONS.filter((o) => o.cm >= draftFilters.heightRange[0]).map((o) => (
                    <option key={o.cm} value={o.cm}>
                      {cmToFeetInches(o.cm)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="member-filter-section member-filter-section--full">
            <span
              id="browse-diet-label"
              className="member-filter-section-label"
              title="Turn a tag off to hide people in that group"
            >
              Diet
            </span>
            <div className="member-filter-chip-group" role="group" aria-labelledby="browse-diet-label">
              {DIET_ALL.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={
                    draftFilters.dietF.includes(o)
                      ? 'member-filter-chip member-filter-chip--selected'
                      : 'member-filter-chip'
                  }
                  aria-pressed={draftFilters.dietF.includes(o)}
                  onClick={() =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      dietF: prev.dietF.includes(o)
                        ? prev.dietF.filter((x) => x !== o)
                        : [...prev.dietF, o],
                    }))
                  }
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="member-browse-filters-pair member-filter-section--full">
            <div className="member-filter-section">
              <span id="browse-religion-label" className="member-filter-section-label">
                Religion
              </span>
              <div className="member-filter-chip-group" role="group" aria-labelledby="browse-religion-label">
                {RELIGION_ALL.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={
                      draftFilters.religionF.includes(o)
                        ? 'member-filter-chip member-filter-chip--selected'
                        : 'member-filter-chip'
                    }
                    aria-pressed={draftFilters.religionF.includes(o)}
                    onClick={() =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        religionF: prev.religionF.includes(o)
                          ? prev.religionF.filter((x) => x !== o)
                          : [...prev.religionF, o],
                      }))
                    }
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div className="member-filter-section">
              <span id="browse-community-label" className="member-filter-section-label">
                Community
              </span>
              <div className="member-filter-chip-group" role="group" aria-labelledby="browse-community-label">
                {COMMUNITY_ALL.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={
                      draftFilters.communityF.includes(o)
                        ? 'member-filter-chip member-filter-chip--selected'
                        : 'member-filter-chip'
                    }
                    aria-pressed={draftFilters.communityF.includes(o)}
                    onClick={() =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        communityF: prev.communityF.includes(o)
                          ? prev.communityF.filter((x) => x !== o)
                          : [...prev.communityF, o],
                      }))
                    }
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="member-browse-grid">
        <div className="member-browse-result-line">
          <span>
            {filtered.length === 0
              ? candidates.length === 0
                ? 'No profiles to show yet.'
                : 'No profiles match these filters.'
              : `${filtered.length} profile${filtered.length === 1 ? '' : 's'} match your filters`}
          </span>
          {trayFull && (
            <span className="member-browse-result-line-warn">
              Tray full (3/3). Submit or remove one before adding another.
            </span>
          )}
        </div>
        <div className="member-browse-cards">
          {filtered.length === 0 && (
            <div className="member-browse-empty" style={{ gridColumn: '1 / -1' }}>
              <p className="member-browse-empty-title">
                {candidates.length === 0 ? 'Nothing to browse yet' : 'No matching profiles'}
              </p>
              {candidates.length === 0 ? (
                <p className="member-browse-empty-desc">
                  Nothing loaded to show. The database only returns profiles that match your{' '}
                  <strong>Show profiles of</strong> setting (stored as <strong>seeking_gender</strong>), are{' '}
                  <strong>active</strong>, visible for browsing, and have <strong>membership_expires_at</strong> in the
                  future. Other people must also have <strong>auth_user_id</strong> linked to their login. Run{' '}
                  <code style={{ fontSize: 13 }}>supabase/verify_browse_setup.sql</code> in the Supabase SQL editor (same
                  project as the app) to verify migration and data. Need help?{' '}
                  <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.
                </p>
              ) : (
                <>
                  <p className="member-browse-empty-desc">
                    Widen your age or height range, or turn diet / religion / community options back on (all
                    selected shows everyone in those groups).
                  </p>
                  <div className="member-browse-empty-actions">
                    <button type="button" className="btn btn-primary" onClick={clearFilters}>
                      Reset all filters
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
            {filtered.map((c) => {
              const inTray = tray.includes(c.id);
              const blocked = requestedCandidateIds.has(c.id);
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
                    <div className="member-browse-card-actions" style={{ display: 'flex', gap: 6, marginTop: 10 }}>
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
                        {blocked ? '✓ Details available' : inTray ? '✕ Remove' : '+ Request'}
                      </button>
                    </div>
                    {blocked && (
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        Already requested. View details under My requests.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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
                  <div key={id} className="member-tray-chip">
                    <div className="member-tray-chip-photo">
                      <ProfileThumb profileId={id} firstName={c?.first_name ?? 'Member'} />
                    </div>
                    <div className="member-tray-chip-meta">
                      <span className="member-tray-chip-name">{c?.first_name ?? 'Member'}</span>
                      <button
                        type="button"
                        className="member-tray-chip-remove"
                        title={`Remove ${c?.first_name ?? 'this candidate'}`}
                        onClick={() => addTray(id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
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
                {submitError.type === 'already_requested' && (
                  <><strong>Already requested.</strong> {submitError.message}</>
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
          blocked={requestedCandidateIds.has(selectedProfile.id)}
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
          <div className="card modal-panel modal-panel--wide" onClick={(e) => e.stopPropagation()}>
            <h2 id="contacts-dialog-title" style={{ marginTop: 0 }}>
              Here are their contact details
            </h2>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              You requested {contactsOpen.contacts.length} profile{contactsOpen.contacts.length === 1 ? '' : 's'}.
              Respect their privacy and the society&apos;s guidelines when you get in touch.
            </p>
            <div className="contacts-success-grid">
              {contactsOpen.contacts.map((c) => {
                const wa = whatsappUrlFromPhone(c.mobile);
                return (
                  <article key={c.profile_id} className="contact-success-card">
                    <div className="contact-success-card-photo">
                      <ProfileThumb profileId={c.profile_id} firstName={c.first_name} />
                    </div>
                    <div className="contact-success-card-body">
                      <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
                        {c.full_name}
                        {c.reference_number ? (
                          <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', fontSize: 14 }}>
                            {' '}
                            · Ref {c.reference_number}
                          </span>
                        ) : null}
                      </h3>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                        <a href={telHref(c.mobile)} style={{ fontWeight: 600 }}>
                          {c.mobile}
                        </a>
                        <br />
                        <a href={`mailto:${encodeURIComponent(c.email)}`}>{c.email}</a>
                      </p>
                      {(c.father_name || c.mother_name) && (
                        <p
                          style={{
                            margin: '10px 0 0',
                            fontSize: 13,
                            color: 'var(--color-text-secondary)',
                            lineHeight: 1.45,
                          }}
                        >
                          {c.father_name ? (
                            <>
                              Father: {c.father_name}
                              <br />
                            </>
                          ) : null}
                          {c.mother_name ? <>Mother: {c.mother_name}</> : null}
                        </p>
                      )}
                      <div className="contact-success-actions">
                        {wa ? (
                          <a
                            className="btn-whatsapp"
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`WhatsApp ${c.first_name}`}
                          >
                            WhatsApp
                          </a>
                        ) : null}
                        <a className="btn btn-secondary" href={telHref(c.mobile)}>
                          Call
                        </a>
                        <a className="btn btn-secondary" href={`mailto:${encodeURIComponent(c.email)}`}>
                          Email
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 8 }}>
              These details are also available any time under <strong>My requests</strong>.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setContactsOpen(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
