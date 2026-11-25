/**
 * Whether an applicant must pay the registration fee before submitting.
 *
 * Single source of truth, imported by BOTH submit-registration (server) and
 * src/pages/Register.tsx (browser). Keep this file free of Deno/browser-only imports.
 *
 * A resubmission after rejection never pays again: the original fee covers it, and
 * create-checkout-session refuses anyone who already has a profile. Before this was
 * shared, the browser still demanded payment from rejected applicants, so they hit a
 * 400 on "Pay £10" and could never resubmit (Nov 2026).
 */
export function registrationFeeDue(opts: {
  billingEnabled: boolean;
  couponValid: boolean;
  isResubmit: boolean;
}): boolean {
  return opts.billingEnabled && !opts.couponValid && !opts.isResubmit;
}
