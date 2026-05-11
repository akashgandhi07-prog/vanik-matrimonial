/** SYNC: same default as `src/lib/privacyPolicyVersion.ts` (“Last updated” on /privacy). */
export const DEFAULT_PRIVACY_POLICY_VERSION_ID = '2026-05-11';

/** Optional Edge secret `PRIVACY_POLICY_VERSION` overrides stored consent version without redeploy. */
export function resolvedPrivacyPolicyVersionId(): string {
  const fromEnv = Deno.env.get('PRIVACY_POLICY_VERSION')?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PRIVACY_POLICY_VERSION_ID;
}
