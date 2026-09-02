/** Rolling window and quota helpers shared by Browse and My Requests. */

export const WEEK_MS = 7 * 86400000;
export const FEEDBACK_STALE_MS = 21 * 86400000;

/** Base caps before admin-applied bonuses (see `member_private.contact_request_*_bonus`). */
export const CONTACT_REQUEST_WEEKLY_BASE = 3;
export const CONTACT_REQUEST_MONTHLY_BASE = 6;
/**
 * Outer bound of the server's `LEAST(10, weekly_limit, monthly_limit)` per
 * submission. Mirrored in supabase/functions/_shared/contact-request-limits.ts;
 * `maxCandidatesPerSubmit` below applies the per-member part.
 */
export const CONTACT_REQUEST_MAX_PER_SUBMIT = 10;

export function effectiveWeeklyCap(weeklyBonus = 0): number {
  return CONTACT_REQUEST_WEEKLY_BASE + Math.max(0, weeklyBonus);
}

export function effectiveMonthlyCap(monthlyBonus = 0): number {
  return CONTACT_REQUEST_MONTHLY_BASE + Math.max(0, monthlyBonus);
}

export function maxCandidatesPerSubmit(weeklyCap: number, monthlyCap: number): number {
  return Math.min(CONTACT_REQUEST_MAX_PER_SUBMIT, weeklyCap, monthlyCap);
}

export type RequestSummary = {
  id: string;
  created_at: string;
  candidate_ids: string[];
};

export type QuotaWindow = {
  used: number;
  remaining: number;
  cap: number;
  locked: boolean;
  resetAt: string | null;
};

export function monthStartUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function nextMonthStartUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export function computeWeeklyWindow(requests: RequestSummary[], weeklyCap = CONTACT_REQUEST_WEEKLY_BASE): QuotaWindow {
  const cutoff = Date.now() - WEEK_MS;
  const usedCandidateIds = new Set<string>();
  let oldestRecentRequestMs: number | null = null;

  for (const r of requests) {
    const requestMs = new Date(r.created_at).getTime();
    if (Number.isNaN(requestMs) || requestMs <= cutoff) continue;
    oldestRecentRequestMs = oldestRecentRequestMs == null ? requestMs : Math.min(oldestRecentRequestMs, requestMs);
    const candidateIds = Array.isArray(r.candidate_ids) ? r.candidate_ids : [];
    for (const candidateId of candidateIds) usedCandidateIds.add(candidateId);
  }

  const used = usedCandidateIds.size;
  const cap = Math.max(CONTACT_REQUEST_WEEKLY_BASE, weeklyCap);
  const remaining = Math.max(0, cap - used);
  return {
    used,
    remaining,
    cap,
    locked: remaining === 0,
    resetAt:
      oldestRecentRequestMs != null
        ? new Date(oldestRecentRequestMs + WEEK_MS).toLocaleDateString('en-GB')
        : null,
  };
}

export function computeMonthlyWindow(
  requests: RequestSummary[],
  monthlyCap = CONTACT_REQUEST_MONTHLY_BASE
): QuotaWindow {
  const start = monthStartUtc();
  const usedCandidateIds = new Set<string>();

  for (const r of requests) {
    const requestMs = new Date(r.created_at).getTime();
    if (Number.isNaN(requestMs) || requestMs < start.getTime()) continue;
    const candidateIds = Array.isArray(r.candidate_ids) ? r.candidate_ids : [];
    for (const candidateId of candidateIds) usedCandidateIds.add(candidateId);
  }

  const used = usedCandidateIds.size;
  const cap = Math.max(CONTACT_REQUEST_MONTHLY_BASE, monthlyCap);
  const remaining = Math.max(0, cap - used);
  return {
    used,
    remaining,
    cap,
    locked: remaining === 0,
    resetAt: nextMonthStartUtc().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}

/** How many profiles the request tray can hold right now (server-aligned). */
export function computeTrayCapacity(
  weeklyRemaining: number,
  monthlyRemaining: number,
  weeklyCap: number,
  monthlyCap: number
): number {
  const maxBatch = maxCandidatesPerSubmit(weeklyCap, monthlyCap);
  return Math.max(0, Math.min(maxBatch, weeklyRemaining, monthlyRemaining));
}

/**
 * Same rule as submit-contact-request: requests older than 21 days need feedback
 * for every candidate before new requests are allowed.
 */
export function hasOutstandingFeedbackBlock(
  requests: RequestSummary[],
  feedbackKeys: Set<string>,
  nowMs = Date.now()
): boolean {
  return outstandingFeedbackItems(requests, feedbackKeys, nowMs).some((item) => item.blocking);
}

export type OutstandingFeedbackItem = {
  requestId: string;
  /** ISO timestamp the introduction was requested. */
  createdAt: string;
  /** Candidates from that request with no feedback written yet. */
  candidateIds: string[];
  /** ISO timestamp the 21-day grace period runs out. */
  dueAt: string;
  /** True once the grace period has passed, i.e. this request now blocks new ones. */
  blocking: boolean;
};

/**
 * Every introduction still missing feedback, oldest first, with the date its
 * 21-day grace period ends. `blocking` marks the ones the server already
 * refuses new requests over; the rest are a warning of what is coming.
 */
export function outstandingFeedbackItems(
  requests: RequestSummary[],
  feedbackKeys: Set<string>,
  nowMs = Date.now()
): OutstandingFeedbackItem[] {
  const items: OutstandingFeedbackItem[] = [];
  for (const r of requests) {
    const requestMs = new Date(r.created_at).getTime();
    if (Number.isNaN(requestMs)) continue;
    const candidateIds = Array.isArray(r.candidate_ids) ? r.candidate_ids : [];
    const missing = candidateIds.filter((cid) => !feedbackKeys.has(`${r.id}:${cid}`));
    if (missing.length === 0) continue;
    items.push({
      requestId: r.id,
      createdAt: r.created_at,
      candidateIds: missing,
      dueAt: new Date(requestMs + FEEDBACK_STALE_MS).toISOString(),
      blocking: nowMs - requestMs >= FEEDBACK_STALE_MS,
    });
  }
  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
