/**
 * Post-build step: writes static HTML for every public page so crawlers and AI tools that don't run
 * JavaScript get the full text, title, description, canonical and structured data.
 *
 * Runs after `vite build` (client, into dist/) and `vite build --ssr src/entry-server.tsx` (into
 * dist-ssr/). Output, served by Vercel with cleanUrls:
 *   dist/index.html            homepage
 *   dist/<path>.html           every other public page (e.g. dist/guides/first-meeting.html)
 *   dist/404.html              real 404 for unknown URLs
 *   dist/app.html              noindex shell for signed-in and account routes (see vercel.json, served at /app)
 *   dist/sitemap.xml, dist/llms.txt
 *
 * Never put member data in any of these files: only routes in prerenderPaths() are rendered, and
 * they render the signed-out view without fetching anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const dist = path.join(root, 'dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const ssr = await import(pathToFileURL(path.join(root, 'dist-ssr', 'entry-server.js')).href);
const { render, pageMetaFor, prerenderPaths, structuredDataFor, canonicalUrl, SITE_NAME, SITE_ORIGIN, CONTENT_PAGES, GUIDES } = ssr;

const TITLE_TAG = '<title>Vanik Matrimonial Register</title>';
for (const marker of [TITLE_TAG, '<!--app-head-->', '<!--app-html-->']) {
  if (!template.includes(marker)) throw new Error(`prerender: index.html is missing ${marker}`);
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON inside <script> must not be able to close the tag. */
const jsonForScript = (v) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c');

function fill({ title, head, html }) {
  return template
    .replace(TITLE_TAG, `<title>${esc(title)}</title>`)
    .replace('<!--app-head-->', head)
    .replace('<!--app-html-->', html);
}

function indexableHead(pathname, meta) {
  const url = canonicalUrl(pathname);
  const description = meta.description ?? '';
  const type = meta.content?.kind === 'guide' ? 'article' : 'website';
  return [
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<script type="application/ld+json">\n${jsonForScript(structuredDataFor(pathname))}\n</script>`,
  ].join('\n    ');
}

function outFile(pathname) {
  return pathname === '/' ? path.join(dist, 'index.html') : path.join(dist, `${pathname.slice(1)}.html`);
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

const paths = prerenderPaths();
for (const pathname of paths) {
  const meta = pageMetaFor(pathname);
  const html = render(pathname);
  if (html.includes('Loading…') || !html.includes('<h1')) {
    throw new Error(`prerender: ${pathname} did not render its content (no <h1> or still loading)`);
  }
  write(outFile(pathname), fill({ title: meta.title, head: indexableHead(pathname, meta), html }));
}

write(
  path.join(dist, '404.html'),
  fill({
    title: `Page not found - ${SITE_NAME}`,
    head: '<meta name="robots" content="noindex" />',
    html: render('/__page-not-found__'),
  })
);

// Signed-in and account routes render entirely in the browser.
write(
  path.join(dist, 'app.html'),
  fill({ title: SITE_NAME, head: '<meta name="robots" content="noindex" />', html: '' })
);

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...paths.map((p) => {
    const updated = pageMetaFor(p).updated;
    return `  <url><loc>${esc(canonicalUrl(p))}</loc>${updated ? `<lastmod>${updated}</lastmod>` : ''}</url>`;
  }),
  '</urlset>',
  '',
].join('\n');
write(path.join(dist, 'sitemap.xml'), sitemap);

const link = (e) => `- [${e.heading}](${SITE_ORIGIN}${e.path}): ${e.description}`;
const llms = `# ${SITE_NAME}

> A private, not-for-profit matrimonial introduction service for Gujarati Hindu and Jain families, run by volunteers of Vanik Council (UK), a registered charity in England and Wales (no. 1137083) founded in 1978. The register has run for over 40 years and has led to hundreds of marriages.

Key facts:
- Open to adults aged 18 and over from all Gujarati Hindu and Jain families, Vanik or not. Mainly UK based; members living abroad are welcome.
- Membership costs £10 a year. Not-for-profit, no advertising, data never sold.
- Every application, including proof of identity, is checked by a volunteer within 2 working days.
- Members browse verified profiles and request contact details, up to three introductions at a time. Contact details are only shown inside the member dashboard; names, photos and contact details are never displayed publicly.
- Profiles can be previewed before joining: ${SITE_ORIGIN}/demo
- Vanik Council also runs speed dating events twice a year.
- Contact: matrimonial@vanikcouncil.uk

## Main pages
- [Home](${SITE_ORIGIN}/): What the register is and how it works
- [Register](${SITE_ORIGIN}/register): Join for £10 a year
- [Preview profiles](${SITE_ORIGIN}/demo): Browse a preview of verified profiles
${CONTENT_PAGES.map(link).join('\n')}
- [Privacy policy](${SITE_ORIGIN}/privacy): How member data is protected

## Guides
${GUIDES.map(link).join('\n')}
`;
write(path.join(dist, 'llms.txt'), llms);

console.log(`prerender: wrote ${paths.length} pages, 404.html, app.html, sitemap.xml, llms.txt`);
// The SSR bundle imports the Supabase client, whose timers would keep Node alive.
process.exit(0);
