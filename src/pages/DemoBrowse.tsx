import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrowseCardSkeleton } from '../components/BrowseCardSkeleton';
import ProfileCard from '../components/ProfileCard';
import { PublicLayout } from '../components/Layout';
import { DualRangeSlider } from '../components/DualRangeSlider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  cmToFeetInches,
  formatHeightForFilter,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
} from '../lib/heights';
import { EdgeFunctionHttpError, getAccessToken, postFunctionOptionalAuth } from '../lib/supabase';

type DemoProfile = {
  id: string;
  reference_number: string | null;
  first_name: string;
  age: number | null;
  created_at: string;
  job_title: string | null;
  height_cm: number | null;
  diet: string | null;
  religion: string | null;
  nationality: string | null;
  place_of_birth: string | null;
  gender: string | null;
};

const AGE_MIN = 18;
const AGE_MAX = 80;
const DEFAULT_AGE: [number, number] = [18, 60];
const DEFAULT_HEIGHT: [number, number] = [142, 198];
const DIET_ALL = ['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'] as const;
const RELIGION_ALL = ['Jain', 'Hindu', 'Other'] as const;

type BrowseFilters = {
  ageRange: [number, number];
  dietF: string[];
  religionF: string[];
  heightRange: [number, number];
  sort: 'newest' | 'age';
};

function defaultFilters(): BrowseFilters {
  return {
    ageRange: [...DEFAULT_AGE],
    dietF: [...DIET_ALL],
    religionF: [...RELIGION_ALL],
    heightRange: [...DEFAULT_HEIGHT],
    sort: 'age',
  };
}

function cloneFilters(filters: BrowseFilters): BrowseFilters {
  return {
    ageRange: [...filters.ageRange],
    dietF: [...filters.dietF],
    religionF: [...filters.religionF],
    heightRange: [...filters.heightRange],
    sort: filters.sort,
  };
}

function inFilterSet(value: string, allowed: readonly string[]): boolean {
  const v = value.trim().toLowerCase();
  return allowed.some((a) => a.toLowerCase() === v);
}

function profileMatchesSeeking(
  gender: string | null | undefined,
  seeking: 'Male' | 'Female' | 'Both'
): boolean {
  if (seeking === 'Both') return true;
  if (gender == null || !String(gender).trim()) return false;
  return gender.trim().toLowerCase() === seeking.toLowerCase();
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
    a.sort === b.sort
  );
}

export default function DemoBrowse() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<DemoProfile[]>([]);
  const [browseSeeking, setBrowseSeeking] = useState<'Male' | 'Female' | 'Both'>('Both');
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>('cm');
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>(() => defaultFilters());
  const isMobileFilters = useMediaQuery('(max-width: 639px)');
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);

  useEffect(() => {
    if (!isMobileFilters || !filtersSheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileFilters, filtersSheetOpen]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = (await postFunctionOptionalAuth('demo-browse-profiles', {}, token)) as {
        profiles?: Array<
          Omit<DemoProfile, 'id' | 'reference_number' | 'first_name'> & {
            demo_id: string;
            demo_label?: string;
          }
        >;
        demo_unavailable_for_admin?: boolean;
      };
      if (res.demo_unavailable_for_admin) {
        setError('Demo browse uses member visibility rules. Sign in with a member account to preview.');
        setProfiles([]);
        return;
      }
      const rows = res.profiles ?? [];
      setProfiles(
        rows.map((p) => ({
          id: p.demo_id,
          reference_number: null,
          first_name: p.demo_label ?? '',
          age: p.age,
          created_at: p.created_at,
          job_title: p.job_title,
          height_cm: p.height_cm,
          diet: p.diet,
          religion: p.religion,
          nationality: p.nationality,
          place_of_birth: p.place_of_birth,
          gender: p.gender,
        }))
      );
    } catch (e) {
      if (e instanceof EdgeFunctionHttpError && e.code === 'auth_required') {
        setError('Sign in to explore how member profiles appear to other members.');
      } else if (e instanceof EdgeFunctionHttpError && e.code === 'rate_limited') {
        setError('Too many requests. Please try again later.');
      } else {
        const msg = e instanceof Error ? e.message : 'Could not load demo profiles.';
        if (msg.includes('Not authenticated')) {
          setError('Sign in to explore how member profiles appear to other members.');
        } else if (msg.includes('Too many attempts') || msg.includes('rate_limited')) {
          setError('Too many requests. Please try again later.');
        } else {
          setError(msg);
        }
      }
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const filtered = useMemo(() => {
    const { ageRange, dietF, religionF, heightRange, sort } = appliedFilters;
    let rows = profiles.filter((c) => {
      if (!profileMatchesSeeking(c.gender, browseSeeking)) return false;
      if (c.age != null && (c.age < ageRange[0] || c.age > ageRange[1])) return false;
      if (dietF.length && c.diet && !inFilterSet(c.diet, dietF)) return false;
      if (religionF.length && c.religion && !inFilterSet(c.religion, religionF)) return false;
      const h = c.height_cm;
      if (h != null && h > 0 && (h < heightRange[0] || h > heightRange[1])) return false;
      return true;
    });
    if (sort === 'newest') {
      rows = [...rows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else {
      rows = [...rows].sort((a, b) => (a.age ?? 999) - (b.age ?? 999));
    }
    return rows;
  }, [profiles, appliedFilters, browseSeeking]);

  const pendingFilterChanges = useMemo(() => {
    return !filtersEqual(draftFilters, appliedFilters);
  }, [draftFilters, appliedFilters]);

  const filtersActive = useMemo(() => {
    return !filtersEqual(appliedFilters, defaultFilters()) || browseSeeking !== 'Both';
  }, [appliedFilters, browseSeeking]);

  function applyFilters() {
    setAppliedFilters(cloneFilters(draftFilters));
  }

  function onApplyFiltersClick() {
    applyFilters();
    if (isMobileFilters) setFiltersSheetOpen(false);
  }

  function clearFilters() {
    const defaults = defaultFilters();
    setDraftFilters(defaults);
    setAppliedFilters(cloneFilters(defaults));
    setBrowseSeeking('Both');
  }

  return (
    <PublicLayout>
      <div className="layout-max">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>Demo browse profiles</h1>
          <p style={{ marginTop: 0, color: 'var(--color-text-secondary)' }}>
            Preview how member browse works. Use the filters below to narrow the list. Register and get approved to see
            full profiles, photos, and contact details.
          </p>
        </div>

        {/* CTA banner */}
        <div className="demo-cta">
          <div className="demo-cta-text">
            <strong>Ready to get in touch?</strong>
            <p>
              Membership is £10. Once your application is approved you can request
              contact details directly from this register.
            </p>
          </div>
          <Link to="/register" className="btn btn-primary demo-cta-btn">
            Apply for £10
          </Link>
        </div>

        {isMobileFilters && (
          <div className="member-filters-mobile-trigger-bar">
            <button
              type="button"
              className="member-filters-mobile-trigger"
              aria-expanded={filtersSheetOpen}
              aria-controls="demo-browse-filters-panel"
              onClick={() => setFiltersSheetOpen(true)}
            >
              <span className="member-filters-mobile-trigger-title">Filters</span>
              <span className="member-filters-mobile-trigger-meta">
                {filtered.length} profile{filtered.length === 1 ? '' : 's'}
                {pendingFilterChanges ? ' · unsaved changes' : ''}
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
          id="demo-browse-filters-panel"
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
              <h2 className="member-filters-sheet-toolbar-title">Filters</h2>
              <button
                type="button"
                className="btn btn-secondary member-filters-sheet-done"
                onClick={() => setFiltersSheetOpen(false)}
              >
                Done
              </button>
            </div>
          ) : null}
          <div className="member-browse-filters-head">
            <h2 className="member-browse-filters-title">Filters</h2>
          </div>

          <div className="member-browse-filters-grid">
            <div className="member-filter-section member-filter-section--full">
              <span id="demo-seeking-label" className="member-filter-section-label">
                Show profiles of
              </span>
              <div className="member-filter-chip-row" role="group" aria-labelledby="demo-seeking-label">
                {(['Male', 'Female', 'Both'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={
                      browseSeeking === g
                        ? 'member-filter-chip member-filter-chip--selected member-filter-chip--exclusive'
                        : 'member-filter-chip'
                    }
                    aria-pressed={browseSeeking === g}
                    onClick={() => setBrowseSeeking(g)}
                  >
                    {g === 'Both' ? 'Everyone' : `${g}s`}
                  </button>
                ))}
              </div>
              <p className="member-filter-hint--browse">
                Same options as after login; on this page it only affects the demo browse list.
              </p>
            </div>

            <div className="member-browse-filters-ranges" aria-label="Range filters">
              <div className="member-filter-section">
                <div className="member-filter-range-heading">
                  <span
                    id="demo-age-label"
                    className="member-filter-section-label member-filter-section-label--inline member-filter-section-label--field"
                  >
                    Age
                  </span>
                  <span className="member-filter-range-heading__filler" aria-hidden="true" />
                </div>
                <div role="group" aria-labelledby="demo-age-label">
                  <DualRangeSlider
                    min={AGE_MIN}
                    max={AGE_MAX}
                    step={1}
                    value={draftFilters.ageRange}
                    onChange={(ageRange) => setDraftFilters((prev) => ({ ...prev, ageRange }))}
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
                    id="demo-height-label"
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
                <div role="group" aria-labelledby="demo-height-label">
                  <DualRangeSlider
                    min={HEIGHT_CM_MIN}
                    max={HEIGHT_CM_MAX}
                    step={1}
                    value={draftFilters.heightRange}
                    onChange={(heightRange) => setDraftFilters((prev) => ({ ...prev, heightRange }))}
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
                <span id="demo-diet-label" className="member-filter-section-label member-filter-section-label--field">
                  Diet
                </span>
                <div className="member-filter-chip-group" role="group" aria-labelledby="demo-diet-label">
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
                          dietF: prev.dietF.includes(o) ? prev.dietF.filter((x) => x !== o) : [...prev.dietF, o],
                        }))
                      }
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="member-filter-section">
                <span id="demo-religion-label" className="member-filter-section-label member-filter-section-label--field">
                  Religion
                </span>
                <div className="member-filter-chip-group" role="group" aria-labelledby="demo-religion-label">
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
            <button type="button" className="member-filter-clear" disabled={!filtersActive} onClick={clearFilters}>
              Reset
            </button>
            <div className="member-browse-filters-footer-primary">
              <div className="member-browse-filters-sort-wrap">
                <label htmlFor="demo-sort">Sort</label>
                <select
                  id="demo-sort"
                  className="member-filter-select"
                  value={draftFilters.sort}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({ ...prev, sort: e.target.value as BrowseFilters['sort'] }))
                  }
                >
                  <option value="age">Age</option>
                  <option value="newest">Newest profiles</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pendingFilterChanges}
                onClick={onApplyFiltersClick}
              >
                Apply filters
              </button>
            </div>
          </div>
        </div>

        <section className="member-browse-grid">
          <div className="member-browse-result-line">
            <span>
              {loading ? (
                <span role="status">Loading profiles…</span>
              ) : filtered.length === 0 ? (
                profiles.length === 0 ? (
                  'No profiles to show yet.'
                ) : (
                  'No profiles match these filters.'
                )
              ) : (
                `${filtered.length} profile${filtered.length === 1 ? '' : 's'} match your filters`
              )}
            </span>
          </div>

          <p className="demo-browse-disclaimer" role="note">
            These are redacted example profiles to give you an idea of the different people on the register. More
            information is available once you register and your application is approved.
          </p>

          {error && (
            <div className="member-browse-empty">
              <p className="member-browse-empty-title">Could not load profiles</p>
              <p className="member-browse-empty-desc">{error}</p>
            </div>
          )}

          {loading && !error ? (
            <div className="member-browse-cards">
              {Array.from({ length: 6 }).map((_, i) => (
                <BrowseCardSkeleton key={`demo-sk-${i}`} />
              ))}
            </div>
          ) : null}

          {!loading && !error && (
            <div className="member-browse-cards">
              {filtered.map((c) => (
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
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </PublicLayout>
  );
}
