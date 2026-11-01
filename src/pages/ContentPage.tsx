import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { GUIDES, contentForPath, type ContentEntry } from '../content/content';
import NotFound from './NotFound';

function formatUpdated(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Markdown links are plain anchors; route internal ones through the router instead of reloading. */
function useInternalLinkClicks() {
  const navigate = useNavigate();
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    e.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
}

function RelatedGuides({ current }: { current: ContentEntry }) {
  const others = GUIDES.filter((g) => g.path !== current.path).slice(0, 3);
  if (others.length === 0) return null;
  return (
    <aside className="content-related" aria-labelledby="content-related-title">
      <h2 id="content-related-title">More guides</h2>
      <ul>
        {others.map((g) => (
          <li key={g.path}>
            <Link to={g.path}>{g.heading}</Link>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/guides">All guides</Link>
      </p>
    </aside>
  );
}

export default function ContentPage() {
  const { pathname } = useLocation();
  const onClick = useInternalLinkClicks();
  const entry = contentForPath(pathname);
  if (!entry) return <NotFound />;
  const updated = entry.updated ? formatUpdated(entry.updated) : null;

  return (
    <PublicLayout>
      <article className="layout-max content-page">
        {entry.kind === 'guide' && (
          <nav className="content-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link> <span aria-hidden="true">/</span> <Link to="/guides">Guides</Link>
          </nav>
        )}
        <h1>{entry.heading}</h1>
        {updated && (
          <p className="content-meta">
            By the Vanik Matrimonial Register volunteers &middot; Updated {updated}
          </p>
        )}
        <div className="content-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: entry.html }} />
        {entry.kind === 'guide' && <RelatedGuides current={entry} />}
        <section className="content-cta">
          <p>
            <strong>Ready to meet someone who shares your values?</strong> Membership is £10 a year and every
            member is verified by a Vanik Council volunteer.
          </p>
          <div className="content-cta-actions">
            <Link to="/register" className="btn btn-primary">
              Register (£10/year)
            </Link>
            <Link to="/demo" className="btn btn-secondary">
              Browse Profiles
            </Link>
          </div>
        </section>
      </article>
    </PublicLayout>
  );
}
