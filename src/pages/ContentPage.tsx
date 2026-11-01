import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import GuideCard from '../components/GuideCard';
import RegisterBox from '../components/RegisterBox';
import { contentForPath, relatedGuides, type ContentEntry } from '../content/content';
import NotFound from './NotFound';

function formatDate(iso: string): string | null {
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
    if (!href || !/^\/(?!\/|\\)/.test(href) || href.includes('\\')) return;
    e.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
}

/** Body HTML split before the third `##` section, so a register box can sit mid-article. */
function splitBody(html: string): [string, string] {
  const starts = [...html.matchAll(/<h2[\s>]/g)].map((m) => m.index ?? 0);
  if (starts.length < 4) return [html, ''];
  return [html.slice(0, starts[2]), html.slice(starts[2])];
}

function Byline({ entry }: { entry: ContentEntry }) {
  const updated = entry.updated ? formatDate(entry.updated) : null;
  const published = entry.published ? formatDate(entry.published) : null;
  const author = entry.author || 'Vanik Matrimonial Register volunteers';
  return (
    <div className="content-byline">
      <span className="content-byline-mark" aria-hidden="true">
        {entry.author ? entry.author.charAt(0) : 'V'}
      </span>
      <div>
        <p className="content-byline-who">
          Written by <Link to="/about">{author}</Link>
          {entry.authorRole && <span className="content-byline-role">, {entry.authorRole}</span>}
          {entry.reviewer && (
            <>
              {' '}
              &middot; Reviewed by {entry.reviewer}
              {entry.reviewerRole && <span className="content-byline-role">, {entry.reviewerRole}</span>}
            </>
          )}
        </p>
        <p className="content-byline-when">
          {updated && (
            <>
              Updated <time dateTime={entry.updated}>{updated}</time>
            </>
          )}
          {published && entry.published !== entry.updated && (
            <>
              {' '}
              &middot; First published <time dateTime={entry.published}>{published}</time>
            </>
          )}
          {entry.kind === 'guide' && <> &middot; {entry.readingMinutes} min read</>}
        </p>
      </div>
    </div>
  );
}

function Toc({ entry, className }: { entry: ContentEntry; className: string }) {
  if (entry.toc.length < 3) return null;
  const items = entry.faqSection ? [...entry.toc, { id: 'faq', text: 'Frequently asked questions' }] : entry.toc;
  return (
    <nav className={className} aria-label="On this page">
      <p className="content-toc-title">On this page</p>
      <ol>
        {items.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`}>{t.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Faq({ entry, onClick }: { entry: ContentEntry; onClick: (e: MouseEvent<HTMLElement>) => void }) {
  if (!entry.faqSection || entry.faq.length === 0) return null;
  return (
    <section className="content-faq" id="faq" aria-labelledby="content-faq-title">
      <p className="landing-eyebrow">Quick answers</p>
      <h2 id="content-faq-title">Frequently asked questions</h2>
      <div className="landing-faq" onClick={onClick}>
        {entry.faq.map((f) => (
          <details key={f.question} className="landing-faq-item">
            <summary>{f.question}</summary>
            <div className="content-faq-answer" dangerouslySetInnerHTML={{ __html: f.html ?? `<p>${f.answer}</p>` }} />
          </details>
        ))}
      </div>
    </section>
  );
}

/** Who is behind the advice: the volunteer team, the charity and its track record. */
function AboutAuthors() {
  return (
    <section className="content-authors" aria-labelledby="content-authors-title">
      <span className="content-authors-mark" aria-hidden="true">
        V
      </span>
      <div>
        <h2 id="content-authors-title">Who writes our guides</h2>
        <p>
          Our guides are written by the volunteers who run the Vanik Matrimonial Register for Vanik Council (UK), a
          registered charity (no. 1137083) founded in 1978. The register has helped Gujarati Hindu and Jain families
          for over 40 years and has led to hundreds of marriages, and every member is checked by one of our
          volunteers.
        </p>
        <p className="content-authors-links">
          <Link to="/about">About us</Link>
          <Link to="/how-it-works">How the register works</Link>
          <a href="mailto:matrimonial@vanikcouncil.uk">Email the team</a>
        </p>
      </div>
    </section>
  );
}

function KeepReading({ entry }: { entry: ContentEntry }) {
  const others = relatedGuides(entry);
  if (others.length === 0) return null;
  return (
    <section className="content-related" aria-labelledby="content-related-title">
      <div className="content-related-head">
        <h2 id="content-related-title">Keep reading</h2>
        <Link to="/guides">All guides</Link>
      </div>
      <ul className="guide-card-grid">
        {others.map((g) => (
          <li key={g.path}>
            <GuideCard guide={g} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ContentPage() {
  const { pathname } = useLocation();
  const onClick = useInternalLinkClicks();
  const entry = contentForPath(pathname);
  if (!entry) return <NotFound />;
  const isGuide = entry.kind === 'guide';
  const [before, after] = splitBody(entry.html);
  const audience = entry.audience === 'parents' ? 'parents' : 'singles';

  return (
    <PublicLayout>
      <header className="content-hero">
        <div className="layout-max content-hero-inner">
          <nav className="content-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            {isGuide && (
              <>
                <span aria-hidden="true">/</span>
                <Link to="/guides">Guides</Link>
              </>
            )}
          </nav>
          <p className="landing-kicker">{isGuide ? entry.topic || 'Guide' : 'Vanik Matrimonial Register'}</p>
          <h1 className="content-title">{entry.heading}</h1>
          {entry.description && <p className="content-hero-lead">{entry.description}</p>}
          <Byline entry={entry} />
        </div>
      </header>

      <div className="layout-max content-layout">
        <article className="content-main">
          <Toc entry={entry} className="content-toc content-toc--inline" />
          <div className="content-body content-body--first" onClick={onClick} dangerouslySetInnerHTML={{ __html: before }} />
          {after && (
            <>
              <RegisterBox variant="inline" audience={audience} />
              <div className="content-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: after }} />
            </>
          )}
          <Faq entry={entry} onClick={onClick} />
          {pathname !== '/about' && <AboutAuthors />}
          <RegisterBox variant="end" audience={audience} />
          {isGuide && <KeepReading entry={entry} />}
        </article>

        <aside className="content-aside">
          <div className="content-aside-sticky">
            <RegisterBox variant="aside" audience={audience} />
            <Toc entry={entry} className="content-toc" />
          </div>
        </aside>
      </div>
    </PublicLayout>
  );
}
