/**
 * True when there is no stored Supabase session and no auth token in the URL, so the visitor is
 * certainly signed out and public pages can render immediately instead of showing "Loading…".
 * Also true during build-time prerendering, which always renders the signed-out view.
 */
export function certainlySignedOut(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const { hash, search } = window.location;
    if (hash.includes('access_token=') || new URLSearchParams(search).has('code')) return false;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Wipes any saved registration form draft from browser storage (e.g. on sign-out). */
export function clearRegistrationDraft(): void {
  if (typeof window === 'undefined') return;
  for (const key of ['vmr_registration_v1', 'vmr_registration_owner_v1']) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
