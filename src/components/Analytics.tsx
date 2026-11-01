import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ANALYTICS_ID,
  isAnalyticsPath,
  onConsentReopen,
  readStoredConsent,
  reopenConsent,
  trackPageView,
  withdrawAnalytics,
  writeStoredConsent,
  type AnalyticsConsent,
} from '../lib/analytics';
import './ConsentBanner.css';

/**
 * Google Tag Manager / Analytics with a consent banner. Mount once, inside the router.
 *
 * Renders nothing during prerendering and on first paint: the stored choice is
 * only read inside an effect. Google is never contacted until the visitor clicks
 * Accept, and never on members' or admin pages (see isAnalyticsPath).
 */
export function Analytics() {
  const { pathname, search } = useLocation();
  const [mounted, setMounted] = useState(false);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    if (!ANALYTICS_ID) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored choice after hydration only
    setConsent(readStoredConsent());
    setMounted(true);
    return onConsentReopen(() => setConsent(null));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (consent !== 'granted' || !isAnalyticsPath(pathname)) return;
    // Wait a tick so RouteMeta (and the page itself) can set the new document.title first.
    const timer = window.setTimeout(() => trackPageView(pathname, search), 0);
    return () => window.clearTimeout(timer);
  }, [mounted, consent, pathname, search]);

  if (!mounted || consent !== null || !isAnalyticsPath(pathname)) return null;

  function choose(value: AnalyticsConsent) {
    writeStoredConsent(value);
    if (value === 'denied') withdrawAnalytics();
    setConsent(value);
  }

  return (
    <section className="consent-banner" role="region" aria-label="Cookie choice">
      <p className="consent-banner__text">
        We&apos;d like to use Google Analytics cookies to see how people find the register. No member information is
        ever shared. <Link to="/privacy#cookies">More about cookies</Link>
      </p>
      <div className="consent-banner__actions">
        <button type="button" className="btn btn-secondary consent-banner__btn" onClick={() => choose('denied')}>
          No thanks
        </button>
        <button type="button" className="btn btn-secondary consent-banner__btn" onClick={() => choose('granted')}>
          Accept
        </button>
      </div>
    </section>
  );
}

/** Text-style button that clears the stored choice and shows the banner again. Safe to prerender. */
export function CookieSettingsButton({ className }: { className?: string }) {
  if (!ANALYTICS_ID) return null;
  return (
    <button
      type="button"
      className={className ? `cookie-settings-button ${className}` : 'cookie-settings-button'}
      onClick={() => reopenConsent()}
    >
      Cookie settings
    </button>
  );
}
