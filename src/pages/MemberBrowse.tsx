import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ProfileModal } from '../member/ProfileModal';
import { useMemberArea } from '../member/memberContext';
import type { ProfileRow } from '../member/memberContext';
import {
  computeMonthlyWindow,
  computeTrayCapacity,
  computeWeeklyWindow,
  hasOutstandingFeedbackBlock,
} from '../member/requestQuota';
import { cmToFeetInches, HEIGHT_OPTIONS } from '../lib/heights';
import { EdgeFunctionHttpError, invokeFunction, supabase } from '../lib/supabase';

const DEFAULT_AGE: [number, number] = [18, 60];
const DEFAULT_HEIGHT: [number, number] = [142, 198];
const DIET_ALL = ['Veg', 'Non-veg', 'Vegan'] as const;
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

function inFilterSet(value: string, allowed: readonly string[]): boolean {
  const v = value.trim().toLowerCase();
  return allowed.some((a) => a.toLowerCase() === v);
}

function effectiveSeeking(p: ProfileRow): 'Male' | 'Female' | 'Both' {
  return p.seeking_gender ?? (p.gender === 'Female' ? 'Male' : 'Female');
}

function profileCompletenessPercent(profile: ProfileRow): number {
  const checks = [
    !!profile.education?.trim(),
    !!profile.job_title?.trim(),
    !!profile.height_cm,
    !!profile.diet?.trim(),
    !!profile.hobbies?.trim(),
    !!profile.religion?.trim(),
    !!profile.nationality?.trim(),
    !!profile.place_of_birth?.trim(),
    !!profile.town_country_of_origin?.trim(),
    !!profile.photo_url,
  ];
  const score = checks.filter(Boolean).length;
  return Math.round((score / checks.length) * 100);
}

export default function MemberBrowse() {
  const navigate = useNavigate();
  const { profile, candidates, bookmarks, toggleBookmark, requests, feedbackKeys, loadAll, notice, clearNotice } =
    useMemberArea();
  const [draftFilters, setDraftFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<BrowseFilters>(() => defaultFilters());
  const [tray, setTray] = useState<string[]>([]);
  const [trayDrawerOpen, setTrayDrawerOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);
  const [submitError, setSubmitError] = useState<{
    type: 'weekly_limit' | 'monthly_limit' | 'feedback_required' | 'already_requested' | 'generic';
    message: string;
    requestIds?: string[];
  } | null>(null);
  const [seekUpdating, setSeekUpdating] = useState(false);
  const [seekError, setSeekError] = useState<string | null>(null);
  const [traySubmitting, setTraySubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<{ requestId: string; count: number } | null>(null);

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

  const filtered = useMemo(() => {
    if (!profile) return [];
    const { ageRange, dietF, religionF, heightRange, sort } = appliedFilters;
    let rows = candidates.filter((c) => {
      if (c.age != null && (c.age < ageRange[0] || c.age > ageRange[1])) return false;
      if (dietF.length && c.diet && !inFilterSet(c.diet, dietF)) return false;
      if (religionF.length && c.religion && !inFilterSet(c.religion, religionF)) return false;
      const h = c.height_cm;
      if (h != null && h > 0 && (h < heightRange[0] || h > heightRange[1])) return false;
      return true;
    });
    const requestedRank = (id: string) => (requestedCandidateIds.has(id) ? 1 : 0);
    rows = [...rows].sort((a, b) => {
      const byRequested = requestedRank(a.id) - requestedRank(b.id);
      if (byRequested !== 0) return byRequested;
      if (sort === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sort === 'youngest') {
        return (a.age ?? 999) - (b.age ?? 999);
      }
      return (b.age ?? 0) - (a.age ?? 0);
    });
    return rows;
  }, [profile, candidates, appliedFilters, requestedCandidateIds]);

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
    if (draftFilters.ageRange[0] > draftFilters.ageRange[1]) return;
    if (draftFilters.heightRange[0] > draftFilters.heightRange[1]) return;
    setAppliedFilters(cloneFilters(draftFilters));
  }
  const draftFilterError =
    draftFilters.ageRange[0] > draftFilters.ageRange[1]
      ? 'Minimum age cannot be greater than maximum age.'
      : draftFilters.heightRange[0] > draftFilters.heightRange[1]
        ? 'Minimum height cannot be greater than maximum height.'
        : null;

  const weeklyWindow = useMemo(() => computeWeeklyWindow(requests), [requests]);
  const monthlyWindow = useMemo(() => computeMonthlyWindow(requests), [requests]);
  const trayMax = useMemo(
    () => computeTrayCapacity(weeklyWindow.remaining, monthlyWindow.remaining),
    [weeklyWindow.remaining, monthlyWindow.remaining]
  );
  const feedbackBlocking = useMemo(
    () => hasOutstandingFeedbackBlock(requests, feedbackKeys),
    [requests, feedbackKeys]
  );

  const atTrayCapacity = tray.length >= trayMax;

  useEffect(() => {
    if (tray.length > trayMax) setTray((t) => t.slice(0, trayMax));
  }, [trayMax, tray.length]);

  if (!profile) return null;

  function addTray(id: string) {
    if (tray.includes(id)) {
      setTray((t) => t.filter((x) => x !== id));
      return;
    }
    if (feedbackBlocking || tray.length >= trayMax) return;
    setTray((t) => [...t, id]);
  }

  async function submitTray() {
    if (!profile || tray.length === 0 || feedbackBlocking || traySubmitting) return;
    setSubmitError(null);
    setTraySubmitting(true);
    try {
      const res = (await invokeFunction('submit-contact-request', {
        candidate_ids: tray,
      })) as {
        error?: string;
        message?: string;
        request_id?: string;
        request_ids?: string[];
      };
      if (res.error) {
        throw new EdgeFunctionHttpError(res.message || String(res.error), {
          code: typeof res.error === 'string' ? res.error : undefined,
          requestIds: Array.isArray(res.request_ids)
            ? (res.request_ids as string[]).filter((x): x is string => typeof x === 'string')
            : undefined,
        });
      }
      setTray([]);
      setTrayDrawerOpen(false);
      void loadAll();
      setSubmitSuccess({ requestId: res.request_id ?? '', count: tray.length });
      setSubmitError(null);
    } catch (e) {
      if (e instanceof EdgeFunctionHttpError) {
        const msg = e.message;
        switch (e.code) {
          case 'monthly_limit':
            setSubmitError({ type: 'monthly_limit', message: msg, requestIds: e.requestIds });
            return;
          case 'weekly_limit':
            setSubmitError({ type: 'weekly_limit', message: msg, requestIds: e.requestIds });
            return;
          case 'feedback_required':
            setSubmitError({ type: 'feedback_required', message: msg, requestIds: e.requestIds });
            return;
          case 'already_requested_this_week':
            setSubmitError({ type: 'already_requested', message: msg });
            return;
          default:
            setSubmitError({ type: 'generic', message: msg });
            return;
        }
      }
      const msg = e instanceof Error ? e.message : 'Request failed';
      if (msg.includes('monthly_limit') || msg.includes('Monthly limit')) {
        setSubmitError({ type: 'monthly_limit', message: msg });
      } else if (msg.includes('weekly_limit') || msg.includes('Weekly limit')) {
        setSubmitError({ type: 'weekly_limit', message: msg });
      } else if (msg.includes('feedback_required') || msg.includes('Outstanding feedback')) {
        setSubmitError({ type: 'feedback_required', message: msg });
      } else if (msg.includes('already_requested_this_week') || msg.includes('already requested this profile')) {
        setSubmitError({ type: 'already_requested', message: msg });
      } else {
        setSubmitError({ type: 'generic', message: msg });
      }
    } finally {
      setTraySubmitting(false);
    }
  }

  const trayPaddingBottom = tray.length > 0 ? 'var(--member-tray-height, 100px)' : undefined;

  return (
    <div style={{ paddingBottom: trayPaddingBottom }}>
      <div className="member-browse-filters">
        <div className="member-browse-filters-head">
          <h2 className="member-browse-filters-title">Filters</h2>
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
            {seekError && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-danger)' }} role="alert">
                {seekError}
              </p>
            )}
          </div>

          <div className="member-browse-filters-ranges" aria-label="Range filters">
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
          </div>

          <div className="member-browse-filters-chips-row" aria-label="Preference filters">
            <div className="member-filter-section">
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
          </div>
        </div>

        <div className="member-browse-filters-footer">
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
              disabled={!pendingFilterChanges || !!draftFilterError}
              onClick={applyFilters}
            >
              Apply filters
            </button>
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
      {submitSuccess && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(22,163,74,0.25)',
            background: 'rgba(22,163,74,0.1)',
            color: 'var(--color-success)',
            fontSize: 14,
          }}
        >
          <strong>Request sent.</strong> Contact details for {submitSuccess.count} profile
          {submitSuccess.count === 1 ? '' : 's'} are now available in My requests.
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                navigate('/dashboard/requests', { state: { fromBrowse: true, requestId: submitSuccess.requestId } })
              }
            >
              Go to My requests
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSubmitSuccess(null)}>
              Continue browsing
            </button>
          </div>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
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
            <>All 3 weekly slots used. Resets {weeklyWindow.resetAt ?? 'soon'}.</>
          ) : (
            <>This week: {weeklyWindow.used}/3 distinct profiles used · {weeklyWindow.remaining} remaining</>
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
            <>All 6 monthly slots used. Resets {monthlyWindow.resetAt}.</>
          ) : (
            <>
              This month: {monthlyWindow.used}/6 distinct profiles used · {monthlyWindow.remaining} remaining
            </>
          )}
        </div>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>
        Your tray can hold up to <strong>{trayMax}</strong> profile{trayMax === 1 ? '' : 's'} right now (the lower of
        weekly and monthly slots, and at most 3). Re-requesting the same person after the 7-day cooldown does not use an
        extra monthly slot if you already counted them this month.
      </p>

      <section className="member-browse-grid">
        <div className="member-browse-result-line">
          <span>
            {filtered.length === 0
              ? candidates.length === 0
                ? 'No profiles to show yet.'
                : 'No profiles match these filters.'
              : `${filtered.length} profile${filtered.length === 1 ? '' : 's'} match your filters`}
          </span>
          {atTrayCapacity && trayMax > 0 && (
            <span className="member-browse-result-line-warn">
              Tray full ({tray.length}/{trayMax}). Submit or remove one before adding another.
            </span>
          )}
          {trayMax === 0 && !feedbackBlocking && (
            <span className="member-browse-result-line-warn">
              No request slots available until your weekly or monthly limit resets.
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
                <>
                  <p className="member-browse-empty-desc">
                    There are no profiles to show right now. Try changing <strong>Show profiles of</strong> above, widen
                    your filters, or check back later as new members join. If you think this is wrong, contact{' '}
                    <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.
                  </p>
                  <details style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Site administrators</summary>
                    <p style={{ lineHeight: 1.55, marginTop: 8 }}>
                      See <strong>Browse: no profiles troubleshooting</strong> in{' '}
                      <code style={{ fontSize: 12 }}>docs/SETUP.md</code> in the project repository, and run{' '}
                      <code style={{ fontSize: 12 }}>supabase/verify_browse_setup.sql</code> in the Supabase SQL editor
                      for this project.
                    </p>
                  </details>
                </>
              ) : (
                <>
                  <p className="member-browse-empty-desc">
                    Widen your age or height range, or turn diet / religion options back on (all selected shows
                    everyone in those groups).
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
              const completeness = profileCompletenessPercent(c);
              const canRequestNow = !blocked && !feedbackBlocking && trayMax > 0;
              return (
                <div
                  key={c.id}
                  className="card"
                  style={{ padding: 0, position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
                  onClick={() => setSelectedProfile(c)}
                >
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
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      Profile completeness: <strong>{completeness}%</strong>
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
                        disabled={blocked || (!inTray && (atTrayCapacity || feedbackBlocking))}
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
                    {!blocked && (
                      <p
                        style={{
                          margin: '8px 0 0',
                          fontSize: 12,
                          color: canRequestNow ? 'var(--color-success)' : 'var(--color-warning)',
                        }}
                      >
                        {feedbackBlocking
                          ? 'Request unavailable until pending feedback is submitted.'
                          : trayMax === 0
                            ? 'Request unavailable while weekly/monthly quota is full.'
                            : 'Ready to request.'}
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
            {tray.length}/{trayMax} selected{trayDrawerOpen ? ' - hide' : ' - show'}
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
                    <div className="member-tray-chip-meta">
                      <span className="member-tray-chip-name">
                        {[c?.gender, c?.age != null ? `Age ${c.age}` : null].filter(Boolean).join(' · ') || 'Selected'}
                      </span>
                      <button
                        type="button"
                        className="member-tray-chip-remove"
                        title="Remove from request"
                        onClick={() => addTray(id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={feedbackBlocking || trayMax === 0 || traySubmitting}
              onClick={() => void submitTray()}
            >
              {traySubmitting ? 'Submitting…' : `Request contact details (${tray.length})`}
            </button>
            {feedbackBlocking && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-warning)' }}>
                Complete outstanding feedback on{' '}
                <Link to="/dashboard/requests" style={{ fontWeight: 600, color: 'inherit' }}>
                  My requests
                </Link>{' '}
                before submitting.
              </p>
            )}
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
                  <><strong>Weekly limit reached.</strong> You can request up to 3 profiles per 7-day window. Check My requests to see when your slots reset.</>
                )}
                {submitError.type === 'monthly_limit' && (
                  <><strong>Monthly limit reached.</strong> You can request up to 6 profiles per calendar month. Your slots reset on the 1st of next month.</>
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
          anonymous
          inTray={tray.includes(selectedProfile.id)}
          trayFull={atTrayCapacity}
          trayCapacity={trayMax}
          feedbackRequiredBeforeRequests={feedbackBlocking}
          blocked={requestedCandidateIds.has(selectedProfile.id)}
          bookmarked={bookmarks.includes(selectedProfile.id)}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.id)}
          onToggleTray={() => addTray(selectedProfile.id)}
        />
      )}

    </div>
  );
}
