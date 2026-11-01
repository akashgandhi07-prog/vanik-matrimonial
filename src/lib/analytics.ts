/**
 * Google Tag Manager (which runs Google Analytics 4), consent first and public pages only.
 *
 * Nothing in this module touches `window`, `document` or storage at import time,
 * so it is safe to import during static prerendering. Google's script is only
 * injected after the visitor clicks Accept, and only while they are on a public page.
 *
 * GTM setup this code expects (in the GTM container):
 * - A GA4 Event tag (or Google tag with send_page_view off) firing on the custom event
 *   `page_view_clean`, sending page_path / page_location / page_title from the dataLayer.
 * - In GA4 Admin > Data streams > Enhanced measurement, "Page changes based on browser
 *   history events" turned OFF, so page views are not counted twice.
 * - No Custom HTML tags: the CSP has no 'unsafe-inline', so they would be blocked.
 */

/** GTM container ID. Empty means analytics is switched off entirely (no banner, nothing loaded). */
export const ANALYTICS_ID: string = (import.meta.env.VITE_GTM_ID ?? 'GTM-WQWC68QN').trim();

export const CONSENT_STORAGE_KEY = 'vmr-analytics-consent';

export type AnalyticsConsent = 'granted' | 'denied';

/**
 * Routes where analytics must never record anything. Members' pages hold
 * sensitive data (religion, matrimonial status, contact requests), and the
 * sign-in and account pages can carry tokens or member state in the URL.
 * A path is private if it equals one of these or sits underneath it.
 * Everything else (home, /register, /demo, /privacy, /whats-new, /guides and
 * content pages such as /about or /faq) counts as public.
 */
const PRIVATE_PATH_PREFIXES = [
  '/dashboard',
  '/admin',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email-success',
  '/registration-pending',
  '/registration-rejected',
  '/membership-expired',
  '/renew-membership',
  '/feedback',
  '/app-feedback',
] as const;

/** True only for public pages that analytics may record. Pure, safe anywhere. */
export function isAnalyticsPath(pathname: string): boolean {
  const path = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  return !PRIVATE_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Query parameters worth keeping for "how did people find us". Everything else (e.g. ?ref= invite codes) is dropped. */
const KEPT_QUERY_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'];

/** Page URL with the hash removed (auth redirects put tokens there) and only campaign parameters kept. */
function cleanPageLocation(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of KEPT_QUERY_PARAMS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return `${window.location.origin}${pathname}${query ? `?${query}` : ''}`;
}

/* Consent storage. Every read and write is guarded: private windows and locked-down browsers can throw. */

export function readStoredConsent(): AnalyticsConsent | null {
  try {
    const value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredConsent(value: AnalyticsConsent): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    /* storage unavailable: the choice only lasts for this visit */
  }
}

function clearStoredConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/* "Cookie settings" reopens the banner from anywhere in the tree. */

const reopenListeners = new Set<() => void>();

export function onConsentReopen(listener: () => void): () => void {
  reopenListeners.add(listener);
  return () => {
    reopenListeners.delete(listener);
  };
}

/** Forget the stored choice, switch analytics off and ask again. */
export function reopenConsent(): void {
  const wasGranted = readStoredConsent() === 'granted' || gtmLoaded;
  clearStoredConsent();
  if (wasGranted) {
    // Reloading is the only reliable way to remove GTM once loaded; the banner shows again after it.
    withdrawAnalytics();
    return;
  }
  reopenListeners.forEach((listener) => listener());
}

/* dataLayer plumbing. Set up in module code because the CSP has no 'unsafe-inline' for scripts. */

type Gtag = (...args: unknown[]) => void;

type GtmWindow = Window & {
  dataLayer?: unknown[];
  gtag?: Gtag;
};

let gtmLoaded = false;

function gtmWindow(): GtmWindow {
  return window as unknown as GtmWindow;
}

let routeGuardInstalled = false;

function isPrivateUrl(url: string | URL): boolean {
  try {
    return !isAnalyticsPath(new URL(String(url), window.location.href).pathname);
  } catch {
    return true;
  }
}

/**
 * Private-route guard. GTM cannot be unloaded, so once it is running, any in-app navigation to a
 * private page becomes a full page load: the private page then starts without GTM. Installed when
 * GTM loads; idempotent and browser only.
 */
function installAnalyticsRouteGuard(): void {
  if (routeGuardInstalled || typeof window === 'undefined') return;
  routeGuardInstalled = true;

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function guardedHistory(this: History, data: unknown, unused: string, url?: string | URL | null) {
      if (gtmLoaded && url != null && isPrivateUrl(url)) {
        window.location.assign(new URL(String(url), window.location.href).href);
        return;
      }
      return original.call(this, data, unused, url);
    };
  }

  window.addEventListener('popstate', () => {
    if (gtmLoaded && isPrivateUrl(window.location.href)) window.location.reload();
  });
}

/** Inject GTM once. Only ever called after consent, on a public page. */
function loadGtm(): void {
  if (gtmLoaded || !ANALYTICS_ID) return;
  gtmLoaded = true;
  installAnalyticsRouteGuard();

  const w = gtmWindow();
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // Consent commands must be the real `arguments` object, as in Google's snippet.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };

  w.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  w.gtag('js', new Date());
  w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(ANALYTICS_ID)}`;
  document.head.appendChild(script);
}

/** Record one public page view. Callers must already have checked consent. */
export function trackPageView(pathname: string, search: string): void {
  if (!ANALYTICS_ID || !isAnalyticsPath(pathname)) return;
  loadGtm();
  gtmWindow().dataLayer!.push({
    event: 'page_view_clean',
    page_path: pathname,
    page_location: cleanPageLocation(pathname, search),
    page_title: document.title,
  });
}

/** Expire `_ga` and `_ga_<id>` cookies on this host and on the parent domain. */
function deleteGaCookies(): void {
  let names: string[] = [];
  try {
    names = document.cookie
      .split(';')
      .map((part) => part.split('=')[0]?.trim() ?? '')
      .filter((name) => name === '_ga' || name.startsWith('_ga_'));
  } catch {
    return;
  }
  const host = window.location.hostname;
  const domains = ['', host, `.${host}`, '.vanikcouncil.uk'];
  for (const name of names) {
    for (const domain of domains) {
      try {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ''}`;
      } catch {
        /* keep going with the rest */
      }
    }
  }
}

/**
 * The visitor has said no (or changed their mind): deny storage, remove Google's cookies and, if
 * GTM is already running, reload so it is gone completely.
 */
export function withdrawAnalytics(): void {
  const gtag = gtmWindow().gtag;
  if (gtag) gtag('consent', 'update', { analytics_storage: 'denied' });
  deleteGaCookies();
  if (gtmLoaded) window.location.reload();
}
