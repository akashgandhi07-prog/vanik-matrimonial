import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrowseCardSkeleton } from '../components/BrowseCardSkeleton';
import ProfileCard from '../components/ProfileCard';
import { DualRangeSlider } from '../components/DualRangeSlider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ProfileModal } from '../member/ProfileModal';
import { RequestTrayBar } from '../member/RequestTrayBar';
import { useMemberArea } from '../member/memberContext';
import type { ProfileRow } from '../member/memberContext';
import { maxCandidatesPerSubmit } from '../member/requestQuota';
import { IntroductionSteps } from '../member/IntroductionSteps';
import {
  cmToFeetInches,
  formatHeightForFilter,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
} from '../lib/heights';
import { supabase } from '../lib/supabase';

const AGE_MIN = 18;
const AGE_MAX = 80;
const DEFAULT_AGE: [number, number] = [18, 60];
const DEFAULT_HEIGHT: [number, number] = [142, 198];
const DIET_ALL = ['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'] as const;
const RELIGION_ALL = ['Jain', 'Hindu', 'Other'] as const;
const NEW_PROFILE_WINDOW_MS = 14 * 86400000;

type BrowseFilters = {
  ageRange: [number, number];
  dietF: string[];
  religionF: string[];
  heightRange: [number, number];
  keyword: string;
  sort: 'newest' | 'age';
};

function defaultFilters(): BrowseFilters {
  return {
    ageRange: [...DEFAULT_AGE],
    dietF: [...DIET_ALL],
    religionF: [...RELIGION_ALL],
    heightRange: [...DEFAULT_HEIGHT],
    keyword: '',
    sort: 'age',
  };
}

function cloneFilters(filters: BrowseFilters): BrowseFilters {
  return {
    ageRange: [...filters.ageRange],
    dietF: [...filters.dietF],
    religionF: [...filters.religionF],
    heightRange: [...filters.heightRange],
    keyword: filters.keyword,
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
    a.keyword.trim().toLowerCase() === b.keyword.trim().toLowerCase() &&
    a.sort === b.sort
  );
}

function inFilterSet(value: string, allowed: readonly string[]): boolean {
  const v = value.trim().toLowerCase();
  return allowed.some((a) => a.toLowerCase() === v);
}

function matchesKeyword(c: ProfileRow, rawKeyword: string): boolean {
  const q = rawKeyword.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = [
    c.place_of_birth,
    c.town_country_of_origin,
    c.future_settlement_plans,
    c.nationality,
    c.job_title,
    c.education,
    c.hobbies,
    c.community,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function matchesBrowseFilters(c: ProfileRow, filters: BrowseFilters): boolean {
  const { ageRange, dietF, religionF, heightRange, keyword } = filters;
  if (c.age != null && (c.age < ageRange[0] || c.age > ageRange[1])) return false;
  if (dietF.length && c.diet && !inFilterSet(c.diet, dietF)) return false;
  if (religionF.length && c.religion && !inFilterSet(c.religion, religionF)) return false;
  const h = c.height_cm;
  if (h != null && h > 0 && (h < heightRange[0] || h > heightRange[1])) return false;
  if (!matchesKeyword(c, keyword)) return false;
  return true;
}

function effectiveSeeking(p: ProfileRow): 'Male' | 'Female' | 'Both' {
  return p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female');
}

export default function MemberBrowse() {
  const {
    profile,
    candidates,
    bookmarks,
    toggleBookmark,
    requests,
    requestersOfMe,
    tray,
    toggleTray,
    weeklyCap,
    monthlyCap,
    weeklyWindow,
    monthlyWindow,
    trayMax,
    atTrayCapacity,
    feedbackBlocking,
    loadAll,
    notice,
    clearNotice,
    refreshing,
  } = useMemberArea();
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>('cm');
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);
  const [seekUpdating, setSeekUpdating] = useState(false);
  const [seekError, setSeekError] = useState<string | null>(null);
  const isMobileFilters = useMediaQuery('(max-width: 639px)');
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const [mountTimeMs] = useState(() => Date.now());

  function updateDraftFilters(updater: (prev: BrowseFilters) => BrowseFilters) {
    setDraftFilters((prev) => {
      const next = updater(prev);
      // On desktop, auto-apply valid filter changes immediately so the grid updates live.
      if (
        !isMobileFilters &&
        next.ageRange[0] <= next.ageRange[1] &&
        next.heightRange[0] <= next.heightRange[1]
      ) {
        setAppliedFilters(cloneFilters(next));
      }
      return next;
    });
  }

  useEffect(() => {
    if (!isMobileFilters || !filtersSheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileFilters, filtersSheetOpen]);

  async function persistSeeking(g: 'Male' | 'Female' | 'Both') {
    if (!profile || effectiveSeeking(profile) === g || seekUpdating) return;
    setSeekError(null);
    setSeekUpdating(true);
    try {
      const { error } = await supabase.from('profiles').update({ seeking_gender: g }).eq('id', profile.id);
      if (error) setSeekError(error.message);
      else void loadAll();
    } finally {
      setSeekUpdating(false);
    }
  }

  const requestedCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) {
      for (const cid of (r.candidate_ids as string[]) ?? []) ids.add(cid);
    }
    return ids;
  }, [requests]);

  /** Members in this browse list who have already requested ME - we are introduced. */
  const requesterIds = useMemo(() => new Set(requestersOfMe.map((r) => r.id)), [requestersOfMe]);

  /** Everyone whose contact details this member already has, in either direction. */
  const introducedIds = useMemo(() => {
    const ids = new Set(requestedCandidateIds);
    for (const id of requesterIds) ids.add(id);
    return ids;
  }, [requestedCandidateIds, requesterIds]);

  /** Prominent scope filter: everyone / already have details / not yet introduced. */
  const [browseScope, setBrowseScope] = useState<'all' | 'introduced' | 'new'>('all');

  const attributeFiltered = useMemo(() => {
    if (!profile) return [];
    const { sort } = appliedFilters;
    let rows = candidates.filter((c) => matchesBrowseFilters(c, appliedFilters));
    const requestedRank = (id: string) => (requestedCandidateIds.has(id) ? 1 : 0);
    rows = [...rows].sort((a, b) => {
      const byRequested = requestedRank(a.id) - requestedRank(b.id);
      if (byRequested !== 0) return byRequested;
      if (sort === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return (a.age ?? 999) - (b.age ?? 999);
    });
    return rows;
  }, [profile, candidates, appliedFilters, requestedCandidateIds]);

  const draftMatchCount = useMemo(() => {
    if (!profile) return 0;
    const rows = candidates.filter((c) => matchesBrowseFilters(c, draftFilters));
    if (browseScope === 'introduced') return rows.filter((c) => introducedIds.has(c.id)).length;
    if (browseScope === 'new') return rows.filter((c) => !introducedIds.has(c.id)).length;
    return rows.length;
  }, [profile, candidates, draftFilters, browseScope, introducedIds]);

  const scopeCounts = useMemo(() => {
    let introduced = 0;
    for (const c of attributeFiltered) if (introducedIds.has(c.id)) introduced += 1;
    return { all: attributeFiltered.length, introduced, fresh: attributeFiltered.length - introduced };
  }, [attributeFiltered, introducedIds]);

  const filtered = useMemo(() => {
    if (browseScope === 'introduced') return attributeFiltered.filter((c) => introducedIds.has(c.id));
    if (browseScope === 'new') return attributeFiltered.filter((c) => !introducedIds.has(c.id));
    return attributeFiltered;
  }, [attributeFiltered, browseScope, introducedIds]);

  const filtersActive = useMemo(() => {
    const defaults = defaultFilters();
    return !filtersEqual(appliedFilters, defaults) || !filtersEqual(draftFilters, defaults);
  }, [appliedFilters, draftFilters]);

  const pendingFilterChanges = useMemo(() => {
    return !filtersEqual(draftFilters, appliedFilters);
  }, [draftFilters, appliedFilters]);

  function clearFilters() {
    const defaults = defaultFilters();
    setDraftFilters(defaults);
    setAppliedFilters(cloneFilters(defaults));
    setBrowseScope('all');
  }

  function applyFilters() {
    if (draftFilters.ageRange[0] > draftFilters.ageRange[1]) return;
    if (draftFilters.heightRange[0] > draftFilters.heightRange[1]) return;
    setAppliedFilters(cloneFilters(draftFilters));
  }

  function onApplyFiltersClick() {
    applyFilters();
    if (isMobileFilters) setFiltersSheetOpen(false);
  }
  const draftFilterError =
    draftFilters.ageRange[0] > draftFilters.ageRange[1]
      ? 'Minimum age cannot be greater than maximum age.'
      : draftFilters.heightRange[0] > draftFilters.heightRange[1]
        ? 'Minimum height cannot be greater than maximum height.'
        : null;

  if (!profile) return null;

  const trayPaddingBottom = tray.length > 0 ? 'var(--member-tray-height, 100px)' : undefined;

  return (
    <div style={{ paddingBottom: trayPaddingBottom }}>
      {isMobileFilters && (
        <div className="member-filters-mobile-trigger-bar">
          <button
            type="button"
            className="member-filters-mobile-trigger"
            aria-expanded={filtersSheetOpen}
            aria-controls="member-browse-filters-panel"
            onClick={() => setFiltersSheetOpen(true)}
          >
            <span className="member-filters-mobile-trigger-title">Filters &amp; search</span>
            <span className="member-filters-mobile-trigger-meta">
              {filtered.length} profile{filtered.length === 1 ? '' : 's'}
              {pendingFilterChanges ? ` · ${draftMatchCount} match unsaved changes` : ''}
              {!pendingFilterChanges ? ' · tap to edit' : ''}
            </span>
          </button>
        </div>
      )}
      {isMobileFilters && filtersSheetOpen ? (
        <button
          type="button"
          className="member-filters-sheet-backdrop"
          aria-label="Close filters"
          onClick={() => setFiltersSheetOpen(false)}
        />
      ) : null}
      <div
        id="member-browse-filters-panel"
        className={[
          'member-browse-filters',
          isMobileFilters && filtersSheetOpen ? 'member-browse-filters--mobile-sheet' : '',
          isMobileFilters && !filtersSheetOpen ? 'member-browse-filters--mobile-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isMobileFilters && filtersSheetOpen ? (
          <div className="member-filters-sheet-toolbar">
            <h2 id="member-filters-sheet-title" className="member-filters-sheet-toolbar-title">
              Filters &amp; search
            </h2>
            <button
              type="button"
              className="btn btn-secondary member-filters-sheet-done"
              onClick={() => {
                applyFilters();
                setFiltersSheetOpen(false);
              }}
            >
              Done
            </button>
          </div>
        ) : null}
        <div className="member-browse-filters-head">
          <h2 className="member-browse-filters-title">Filters &amp; search</h2>
        </div>

        <div className="member-browse-filters-grid">
          <div className="member-filter-section member-filter-section--full">
            <span id="browse-seeking-label" className="member-filter-section-label">
              Show profiles of
            </span>
            <div className="member-filter-chip-row" role="group" aria-labelledby="browse-seeking-label">
              {(['Male', 'Female', 'Both'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={
                    effectiveSeeking(profile) === g
                      ? 'member-filter-chip member-filter-chip--selected member-filter-chip--exclusive'
                      : 'member-filter-chip'
                  }
                  aria-pressed={effectiveSeeking(profile) === g}
                  disabled={seekUpdating}
                  onClick={() => void persistSeeking(g)}
                >
                  {g === 'Both' ? 'Everyone' : `${g}s`}
                </button>
              ))}
            </div>
            <p className="member-filter-hint--browse">
              Saved to your account. You can change this in My profile anytime.
            </p>
            {seekError && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-danger)' }} role="alert">
                {seekError}
              </p>
            )}
          </div>

          <div className="member-filter-section member-filter-section--full">
            <label
              htmlFor="browse-keyword"
              className="member-filter-section-label member-filter-section-label--field"
            >
              Location, profession or keyword
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="browse-keyword"
                type="search"
                placeholder="e.g. London, Leicester, doctor, music..."
                value={draftFilters.keyword}
                onChange={(e) => {
                  const keyword = e.target.value;
                  updateDraftFilters((prev) => ({ ...prev, keyword }));
                }}
              />
              {draftFilters.keyword.trim() !== '' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '8px 12px', fontSize: 13, flexShrink: 0 }}
                  onClick={() => updateDraftFilters((prev) => ({ ...prev, keyword: '' }))}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="member-browse-filters-ranges" aria-label="Range filters">
            <div className="member-filter-section">
              <div className="member-filter-range-heading">
                <span
                  id="browse-age-label"
                  className="member-filter-section-label member-filter-section-label--inline member-filter-section-label--field"
                >
                  Age
                </span>
                <span className="member-filter-range-heading__filler" aria-hidden="true" />
              </div>
              <div role="group" aria-labelledby="browse-age-label">
                <DualRangeSlider
                  min={AGE_MIN}
                  max={AGE_MAX}
                  step={1}
                  value={draftFilters.ageRange}
                  onChange={(ageRange) => updateDraftFilters((prev) => ({ ...prev, ageRange }))}
                  formatValue={(n) => String(n)}
                  minLabel={String(AGE_MIN)}
                  maxLabel="80+"
                  lowAriaLabel="Minimum age"
                  highAriaLabel="Maximum age"
                />
              </div>
            </div>

            <div className="member-filter-section">
              <div className="member-filter-range-heading">
                <span
                  id="browse-height-label"
                  className="member-filter-section-label member-filter-section-label--inline member-filter-section-label--field"
                >
                  Height
                </span>
                <div className="member-unit-toggle" role="group" aria-label="Height unit">
                  <button
                    type="button"
                    className={
                      heightUnit === 'cm'
                        ? 'member-unit-toggle__btn member-unit-toggle__btn--active'
                        : 'member-unit-toggle__btn'
                    }
                    aria-pressed={heightUnit === 'cm'}
                    onClick={() => setHeightUnit('cm')}
                  >
                    cm
                  </button>
                  <button
                    type="button"
                    className={
                      heightUnit === 'ft'
                        ? 'member-unit-toggle__btn member-unit-toggle__btn--active'
                        : 'member-unit-toggle__btn'
                    }
                    aria-pressed={heightUnit === 'ft'}
                    onClick={() => setHeightUnit('ft')}
                  >
                    ft
                  </button>
                </div>
              </div>
              <div role="group" aria-labelledby="browse-height-label">
                <DualRangeSlider
                  min={HEIGHT_CM_MIN}
                  max={HEIGHT_CM_MAX}
                  step={1}
                  value={draftFilters.heightRange}
                  onChange={(heightRange) => updateDraftFilters((prev) => ({ ...prev, heightRange }))}
                  formatValue={(cm) => formatHeightForFilter(cm, heightUnit)}
                  minLabel={formatHeightForFilter(HEIGHT_CM_MIN, heightUnit)}
                  maxLabel={formatHeightForFilter(HEIGHT_CM_MAX, heightUnit)}
                  lowAriaLabel="Minimum height"
                  highAriaLabel="Maximum height"
                />
              </div>
            </div>
          </div>

          <div className="member-browse-filters-chips-row" aria-label="Preference filters">
            <div className="member-filter-section">
              <span
                id="browse-diet-label"
                className="member-filter-section-label member-filter-section-label--field"
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
                      updateDraftFilters((prev) => ({
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

            <div className="member-filter-section">
              <span id="browse-religion-label" className="member-filter-section-label member-filter-section-label--field">
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
                      updateDraftFilters((prev) => ({
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
          </div>
        </div>

        <div
          className={[
            'member-browse-filters-footer',
            isMobileFilters && filtersSheetOpen ? 'member-browse-filters-footer--sheet-sticky' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <button
            type="button"
            className="member-filter-clear"
            disabled={!filtersActive}
            onClick={clearFilters}
          >
            Reset
          </button>
          <div className="member-browse-filters-footer-primary">
            <div className="member-browse-filters-sort-wrap">
              <label htmlFor="browse-sort">Sort</label>
              <select
                id="browse-sort"
                className="member-filter-select"
                value={draftFilters.sort}
                onChange={(e) => {
                  const sort = e.target.value as BrowseFilters['sort'];
                  updateDraftFilters((prev) => ({ ...prev, sort }));
                }}
              >
                <option value="age">Age</option>
                <option value="newest">Newest profiles</option>
              </select>
            </div>
            {(isMobileFilters || pendingFilterChanges) && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={(!isMobileFilters && !pendingFilterChanges) || !!draftFilterError}
                onClick={onApplyFiltersClick}
              >
                {`Show ${draftMatchCount} profile${draftMatchCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
        {draftFilterError && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-danger)' }}>
            {draftFilterError}
          </p>
        )}
      </div>

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 13,
            border: `1px solid ${notice.type === 'error' ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.25)'}`,
            background: notice.type === 'error' ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.1)',
            color: notice.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)',
          }}
        >
          {notice.text}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginLeft: 8, padding: '2px 8px' }}
            onClick={clearNotice}
          >
            Dismiss
          </button>
        </div>
      )}
      {feedbackBlocking && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(217,119,6,0.35)',
            background: 'rgba(217,119,6,0.08)',
            fontSize: 14,
            color: 'var(--color-warning)',
          }}
        >
          <strong>Feedback required before new requests.</strong> You have introductions older than 21 days without
          admin-only feedback.{' '}
          <Link to="/dashboard/requests" style={{ color: 'inherit', fontWeight: 600 }}>
            Open My requests
          </Link>{' '}
          to submit outstanding feedback, then you can request contact details again.
        </div>
      )}

      <IntroductionSteps
        weeklyCap={weeklyCap}
        monthlyCap={monthlyCap}
        batchSize={trayMax > 0 ? trayMax : maxCandidatesPerSubmit(weeklyCap, monthlyCap)}
        defaultOpen={requests.length === 0}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            flex: '1 1 200px',
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${weeklyWindow.locked ? 'rgba(217,119,6,0.3)' : 'var(--color-border)'}`,
            background: weeklyWindow.locked ? 'rgba(217,119,6,0.08)' : 'var(--color-surface)',
            fontSize: 13,
            color: weeklyWindow.locked ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          }}
        >
          {weeklyWindow.locked ? (
            <>
              7-day limit: all {weeklyWindow.cap} used. Next slot frees {weeklyWindow.resetAt ?? 'soon'}.
            </>
          ) : (
            <>
              7-day limit: {weeklyWindow.used} of {weeklyWindow.cap} used · {weeklyWindow.remaining} left
            </>
          )}
        </div>
        <div
          style={{
            flex: '1 1 200px',
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${monthlyWindow.locked ? 'rgba(217,119,6,0.3)' : 'var(--color-border)'}`,
            background: monthlyWindow.locked ? 'rgba(217,119,6,0.08)' : 'var(--color-surface)',
            fontSize: 13,
            color: monthlyWindow.locked ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          }}
        >
          {monthlyWindow.locked ? (
            <>
              Month limit: all {monthlyWindow.cap} used. Resets {monthlyWindow.resetAt}.
            </>
          ) : (
            <>
              Month limit: {monthlyWindow.used} of {monthlyWindow.cap} used · {monthlyWindow.remaining} left
            </>
          )}
        </div>
      </div>

      <section className="member-browse-grid">
        {introducedIds.size > 0 && (
          <div
            role="group"
            aria-label="Filter by introduction status"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}
          >
            {(
              [
                ['all', `Everyone (${scopeCounts.all})`],
                ['introduced', `Already have their details (${scopeCounts.introduced})`],
                ['new', `Not yet introduced (${scopeCounts.fresh})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn ${browseScope === value ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={browseScope === value}
                style={{ padding: '8px 14px', fontSize: 13 }}
                onClick={() => setBrowseScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="member-browse-result-line">
          <span>
            {refreshing ? (
              <span role="status">Updating profiles…</span>
            ) : filtered.length === 0 ? (
              candidates.length === 0 ? (
                'No profiles to show yet.'
              ) : (
                'No profiles match these filters.'
              )
            ) : (
              `${filtered.length} profile${filtered.length === 1 ? '' : 's'} match your filters`
            )}
            {!refreshing && filtered.length > 0 ? (
              <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                Photos are not shown on these cards. After you request someone, their picture appears when you open them under{' '}
                <Link to="/dashboard/requests">My requests</Link>.
              </span>
            ) : null}
          </span>
          {atTrayCapacity && trayMax > 0 && (
            <span className="member-browse-result-line-warn">
              Max selected ({tray.length}/{trayMax}). Submit or remove someone to add another.
            </span>
          )}
          {trayMax === 0 && !feedbackBlocking && (
            <span className="member-browse-result-line-warn">
              No request slots left until your 7-day or month limit resets.
            </span>
          )}
        </div>
        <div className="member-browse-cards">
          {refreshing ? (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <BrowseCardSkeleton key={`browse-sk-${i}`} />
              ))}
            </>
          ) : (
            <>
              {filtered.length === 0 && (
                <div className="member-browse-empty" style={{ gridColumn: '1 / -1' }}>
                  <p className="member-browse-empty-title">
                    {candidates.length === 0 ? 'Nothing to browse yet' : 'No matching profiles'}
                  </p>
                  {candidates.length === 0 ? (
                    <p className="member-browse-empty-desc">
                      There are no profiles to show right now. Try changing <strong>Show profiles of</strong> above, widen
                      your filters, or check back later as new members join. If you think this is wrong, contact{' '}
                      <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>.
                    </p>
                  ) : (
                    <>
                      <p className="member-browse-empty-desc">
                        Widen your age or height range, clear your search keyword, or turn diet / religion options back
                        on (all selected shows everyone in those groups).
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
                const requestedMe = requesterIds.has(c.id);
                const createdMs = new Date(c.created_at).getTime();
                const isNew =
                  !blocked &&
                  !requestedMe &&
                  !Number.isNaN(createdMs) &&
                  mountTimeMs - createdMs <= NEW_PROFILE_WINDOW_MS;
                const note = requestedMe ? (
                  'Has requested your details - you already have each other’s contact details.'
                ) : blocked ? (
                  'Opens their card in My requests (photo and contact details).'
                ) : feedbackBlocking ? (
                  <span className="profile-card-note--warn">
                    Request unavailable until pending feedback is submitted.
                  </span>
                ) : trayMax === 0 ? (
                  <span className="profile-card-note--warn">
                    Request unavailable while weekly/monthly quota is full.
                  </span>
                ) : null;
                return (
                  <ProfileCard
                    key={c.id}
                    age={c.age}
                    gender={c.gender}
                    profession={c.job_title}
                    height={c.height_cm != null ? cmToFeetInches(c.height_cm) : null}
                    diet={c.diet}
                    location={c.place_of_birth}
                    religion={c.religion}
                    nationality={c.nationality}
                    education={c.education}
                    hobbies={c.hobbies}
                    settlement={c.future_settlement_plans}
                    isNew={isNew}
                    onOpen={() => setSelectedProfile(c)}
                    note={note}
                    actions={
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleBookmark(c.id);
                          }}
                        >
                          {bookmarks.includes(c.id) ? '★ Saved' : '☆ Save'}
                        </button>
                        {requestedMe ? (
                          <Link
                            to="/dashboard/requests"
                            state={{ tab: 'interested', focusProfileId: c.id }}
                            className="btn btn-primary"
                            style={{ textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            View introduction
                          </Link>
                        ) : blocked ? (
                          <Link
                            to="/dashboard/requests"
                            state={{ focusProfileId: c.id }}
                            className="btn btn-primary"
                            style={{ textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Already requested
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!inTray && (atTrayCapacity || feedbackBlocking)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTray(c.id);
                            }}
                          >
                            {inTray ? '✕ Remove' : '+ Request'}
                          </button>
                        )}
                      </>
                    }
                  />
                );
              })}
            </>
          )}
        </div>
      </section>

      <RequestTrayBar />

      {selectedProfile && (
        <ProfileModal
          candidate={selectedProfile}
          anonymous={!requesterIds.has(selectedProfile.id)}
          contactDetails={(() => {
            const r = requestersOfMe.find((x) => x.id === selectedProfile.id);
            return r?.mobile ? { mobile: r.mobile, linkedin_url: r.linkedin_url } : undefined;
          })()}
          inTray={tray.includes(selectedProfile.id)}
          trayFull={atTrayCapacity}
          trayCapacity={trayMax}
          feedbackRequiredBeforeRequests={feedbackBlocking}
          blocked={requestedCandidateIds.has(selectedProfile.id) || requesterIds.has(selectedProfile.id)}
          allowRequestAction={!requesterIds.has(selectedProfile.id)}
          bookmarked={bookmarks.includes(selectedProfile.id)}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.id)}
          onToggleTray={() => toggleTray(selectedProfile.id)}
        />
      )}
    </div>
  );
}
