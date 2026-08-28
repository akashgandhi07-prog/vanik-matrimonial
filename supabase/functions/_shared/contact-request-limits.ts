/**
 * Absolute ceiling on how many candidates one submission may contain.
 *
 * The real, per-member limit is bonus-aware and lives in the
 * `create_contact_request_atomic` RPC, which enforces
 * `LEAST(10, weekly_limit, monthly_limit)` inside the same transaction that
 * creates the request. This constant is only the outer `10` of that expression:
 * a cheap bound on untrusted input before it reaches the database. Do not
 * re-derive the per-member number here - an edge-side copy went stale once
 * already and rejected members whose allowance an admin had raised.
 *
 * Mirrors CONTACT_REQUEST_MAX_PER_SUBMIT in src/member/requestQuota.ts.
 */
export const CONTACT_REQUEST_MAX_PER_SUBMIT = 10;
