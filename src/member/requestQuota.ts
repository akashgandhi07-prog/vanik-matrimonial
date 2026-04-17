/** Rolling window and quota helpers shared by Browse and My Requests. */

export const WEEK_MS = 7 * 86400000;
export const FEEDBACK_STALE_MS = 21 * 86400000;

export type RequestSummary = {
  id: string;
  created_at: string;
  candidate_ids: string[];
};

export type QuotaWindow = {
  used: number;
  remaining: number;
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

export function computeWeeklyWindow(requests: RequestSummary[]): QuotaWindow {
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
  const remaining = Math.max(0, 3 - used);
  return {
    used,
    remaining,
    locked: remaining === 0,
    resetAt:
      oldestRecentRequestMs != null
        ? new Date(oldestRecentRequestMs + WEEK_MS).toLocaleDateString('en-GB')
        : null,
  };
}

export function computeMonthlyWindow(requests: RequestSummary[]): QuotaWindow {
  const start = monthStartUtc();
  const usedCandidateIds = new Set<string>();

  for (const r of requests) {
    const requestMs = new Date(r.created_at).getTime();
    if (Number.isNaN(requestMs) || requestMs < start.getTime()) continue;
    const candidateIds = Array.isArray(r.candidate_ids) ? r.candidate_ids : [];
    for (const candidateId of candidateIds) usedCandidateIds.add(candidateId);
  }

  const used = usedCandidateIds.size;
  const remaining = Math.max(0, 6 - used);
  return {
    used,
    remaining,
    locked: remaining === 0,
    resetAt: nextMonthStartUtc().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}

/** How many profiles the request tray can hold right now (server-aligned). */
export function computeTrayCapacity(weeklyRemaining: number, monthlyRemaining: number): number {
  return Math.max(0, Math.min(3, weeklyRemaining, monthlyRemaining));
}

/**
 * Same rule as submit-contact-request: requests older than 21 days need feedback * for every candidate before new requests are allowed.
 */
export function hasOutstandingFeedbackBlock(
  requests: RequestSummary[],
  feedbackKeys: Set<string>,
  nowMs = Date.now()
): boolean {
  for (const r of requests) {
    const requestMs = new Date(r.created_at).getTime();
    if (Number.isNaN(requestMs) || nowMs - requestMs < FEEDBACK_STALE_MS) continue;
    const candidateIds = Array.isArray(r.candidate_ids) ? r.candidate_ids : [];
    for (const cid of candidateIds) {
      if (!feedbackKeys.has(`${r.id}:${cid}`)) return true;
    }
  }
  return false;
}
