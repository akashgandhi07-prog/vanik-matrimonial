import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { cmToFeetInches, HEIGHT_OPTIONS } from '../lib/heights';
import { invokeFunction, supabase } from '../lib/supabase';

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

const DEFAULT_AGE: [number, number] = [18, 60];
const DEFAULT_HEIGHT: [number, number] = [142, 198];
const DIET_ALL = ['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'] as const;
const RELIGION_ALL = ['Jain', 'Hindu', 'Other'] as const;

type BrowseFilters = {
  ageRange: [number, number];
  dietF: string[];
  religionF: string[];
  heightRange: [number, number];
  sort: 'newest' | 'youngest' | 'oldest';
};

function defaultFilters(): BrowseFilters {
  return {
    ageRange: [...DEFAULT_AGE],
    dietF: [...DIET_ALL],
    religionF: [...RELIGION_ALL],
    heightRange: [...DEFAULT_HEIGHT],
    sort: 'youngest',
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
  const [authRequired, setAuthRequired] = useState(false);
  const [profiles, setProfiles] = useState<DemoProfile[]>([]);
  const [browseSeeking, setBrowseSeeking] = useState<'Male' | 'Female' | 'Both'>('Both');
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>(() => defaultFilters());

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        setAuthRequired(true);
        setProfiles([]);
        return;
      }
      const res = (await invokeFunction('demo-browse-profiles', {})) as {
        profiles?: Array<
          Omit<DemoProfile, 'id' | 'reference_number' | 'first_name'> & {
            demo_id: string;
            demo_label?: string;
          }
        >;
      };
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
      const msg = e instanceof Error ? e.message : 'Could not load demo profiles.';
      const lower = msg.toLowerCase();
      if (lower.includes('not authenticated') || lower.includes('please sign in') || lower.includes('log in')) {
        setAuthRequired(true);
        setProfiles([]);
      } else if (msg === 'Forbidden' || lower.includes('forbidden')) {
        setError(
          'You need an active membership or admin access to browse profiles here. Complete registration or sign in with an active account.'
        );
        setProfiles([]);
      } else {
        setError(msg);
        setProfiles([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void loadProfiles();
      }
    });
    return () => sub.subscription.unsubscribe();
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
    } else if (sort === 'youngest') {
      rows = [...rows].sort((a, b) => (a.age ?? 999) - (b.age ?? 999));
    } else {
      rows = [...rows].sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
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
          <h1 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>Browse Profiles</h1>
          <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', maxWidth: 620 }}>
            Browse the profiles currently on the register. Photos and contact details are only shared after you become a
            member and make a request. Use the filters below to narrow your search.
          </p>
        </div>

        {/* CTA banner */}
        <div
          style={{
            marginBottom: 24,
            padding: '16px 20px',
            borderRadius: 12,
            background: 'var(--color-primary, #7c3aed)',
            color: '#fff',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong style={{ fontSize: 16 }}>Ready to get in touch?</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.9 }}>
              Membership is £10. Once your application is approved you can request contact details directly from this register.
            </p>
          </div>
          <Link
            to="/register"
            className="btn"
            style={{
              background: '#fff',
              color: 'var(--color-primary, #7c3aed)',
              fontWeight: 700,
              padding: '10px 20px',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
            }}
          >
            Apply - £10
          </Link>
        </div>

        <div className="member-browse-filters">
          <div className="member-browse-filters-head">
            <h2 className="member-browse-filters-title">Filters</h2>
          </div>

          <div className="member-browse-filters-grid">
            <div className="member-filter-section member-filter-section--full">
              <span id="demo-seeking-label" className="member-filter-section-label">
                Show profiles of
              </span>
              <div
                className="member-filter-chip-row"
                role="group"
                aria-labelledby="demo-seeking-label"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}
              >
                {(['Male', 'Female', 'Both'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={browseSeeking === g ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => setBrowseSeeking(g)}
                  >
                    {g === 'Both' ? 'Everyone' : `${g}s`}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
                Same choices as members see after login. Here it only affects this page for now.
              </p>
            </div>

            <div className="member-browse-filters-ranges" aria-label="Range filters">
              <div className="member-filter-section">
                <span id="demo-age-label" className="member-filter-section-label">
                  Age range
                </span>
                <div className="member-filter-range-row" role="group" aria-labelledby="demo-age-label">
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
                <span id="demo-height-label" className="member-filter-section-label">
                  Height range
                </span>
                <div className="member-filter-range-row" role="group" aria-labelledby="demo-height-label">
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
            </div>

            <div className="member-browse-filters-chips-row" aria-label="Preference filters">
              <div className="member-filter-section">
                <span id="demo-diet-label" className="member-filter-section-label">
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
                <span id="demo-religion-label" className="member-filter-section-label">
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

          <div className="member-browse-filters-footer">
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
                  <option value="youngest">Youngest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest profiles</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pendingFilterChanges}
                onClick={applyFilters}
              >
                Apply filters
              </button>
            </div>
          </div>
        </div>

        <section className="member-browse-grid">
          <div className="member-browse-result-line">
            <span>
              {authRequired
                ? 'Sign in to load the register preview.'
                : filtered.length === 0
                  ? profiles.length === 0
                    ? 'No profiles to show yet.'
                    : 'No profiles match these filters.'
                  : `${filtered.length} profile${filtered.length === 1 ? '' : 's'} match your filters`}
            </span>
          </div>

          {loading && <p>Loading profiles…</p>}

          {authRequired && !loading && (
            <div className="member-browse-empty">
              <p className="member-browse-empty-title">Sign in to browse</p>
              <p className="member-browse-empty-desc" style={{ marginBottom: 16 }}>
                The public preview uses your account — sign in with an active membership or an admin account to see
                anonymised profiles. New here? Apply for membership first.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Link to="/login?next=/demo" className="btn btn-primary">
                  Sign in
                </Link>
                <Link to="/register" className="btn btn-secondary">
                  Apply for membership
                </Link>
              </div>
            </div>
          )}

          {error && !authRequired && (
            <div className="member-browse-empty">
              <p className="member-browse-empty-title">Could not load profiles</p>
              <p className="member-browse-empty-desc">{error}</p>
            </div>
          )}

          {!loading && !error && !authRequired && (
            <div className="member-browse-cards">
              {filtered.map((c) => (
                <article key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 14px 14px' }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
                      {[c.gender, c.age != null ? `Age ${c.age}` : null].filter(Boolean).join(' · ') || 'Profile'}
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {[c.job_title, cmToFeetInches(c.height_cm), c.diet].filter(Boolean).join(' · ')}
                    </p>
                    {c.place_of_birth ? (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Location</span>
                        {' · '}
                        {c.place_of_birth}
                      </p>
                    ) : null}
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {[c.religion, c.nationality].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </PublicLayout>
  );
}
