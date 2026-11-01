import { Link } from 'react-router-dom';
import { CookieSettingsButton } from './Analytics';

const FOOTER_LINKS: { to: string; label: string }[] = [
  { to: '/about', label: 'About us' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/faq', label: 'FAQ' },
  { to: '/for-parents', label: 'For parents' },
  { to: '/safety', label: 'Safety' },
  { to: '/events', label: 'Events' },
  { to: '/guides', label: 'Guides' },
  { to: '/compared', label: 'How we compare' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/whats-new', label: "What's new" },
];

/** Site chrome (logo, Hi / login, log out) lives in `SiteHeader` in App. */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <div className="layout-max layout-max--footer">
          <nav aria-label="Footer">
            <ul className="public-footer-nav">
              {FOOTER_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
              <li>
                <CookieSettingsButton />
              </li>
            </ul>
          </nav>
          <p>
            Run by volunteers of <a href="https://www.vanikcouncil.uk/">Vanik Council (UK)</a>, registered
            charity 1137083. Contact:{' '}
            <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
