import DOMPurify from 'isomorphic-dompurify';
import { Marked, type Links, type Token, type Tokens, type TokensList } from 'marked';

/**
 * Public content pages and guides live as Markdown in `/content`. They are bundled at build time,
 * rendered to static HTML by `scripts/prerender.mjs` for crawlers, and rendered by React for visitors.
 *
 * Front matter (one `key: value` per line):
 *   title, description, heading   SEO title, meta description, visible H1
 *   published, updated            ISO dates (YYYY-MM-DD); published defaults to updated
 *   topic                         guides only: section on /guides and the eyebrow above the H1
 *   related                       guides only: comma-separated guide slugs for "Keep reading"
 *   audience                      `parents` swaps the register boxes for parent-facing copy
 *   author, authorRole            a named volunteer, only with their consent; else the volunteer team
 *   reviewer, reviewerRole        a named volunteer who checked the guide, only with their consent
 *
 * A `## Frequently asked questions` section (questions as `###` headings ending in `?`) is pulled out
 * of the body, shown as an accordion and published as FAQPage structured data.
 */

export type ContentKind = 'page' | 'guide';

export type FaqItem = { question: string; answer: string; html?: string };

export type TocItem = { id: string; text: string };

export type ContentEntry = {
  kind: ContentKind;
  slug: string;
  /** Site path, e.g. `/about` or `/guides/first-meeting`. */
  path: string;
  /** SEO title without the site name. */
  title: string;
  description: string;
  /** Visible H1. */
  heading: string;
  /** ISO date (YYYY-MM-DD) the page first went live. */
  published: string;
  /** ISO date (YYYY-MM-DD) of the last meaningful edit. */
  updated: string;
  topic: string;
  related: string[];
  audience: string;
  author: string;
  authorRole: string;
  reviewer: string;
  reviewerRole: string;
  html: string;
  /** `##` headings in the body, for "On this page". */
  toc: TocItem[];
  wordCount: number;
  readingMinutes: number;
  faq: FaqItem[];
  /** True when the FAQ came from its own section, so the page shows it as an accordion. */
  faqSection: boolean;
};

const pageFiles = import.meta.glob('../../content/pages/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const guideFiles = import.meta.glob('../../content/guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FAQ_SECTION = /^frequently asked questions$/i;

function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    data[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { data, body: raw.slice(m[0].length) };
}

/** Markdown inline text to plain text (links keep their label). */
function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** A parser per file so heading ids restart and stay unique within the page. */
function markdownFor() {
  const used = new Set<string>();
  const md = new Marked({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2) return `<h${depth}>${inner}</h${depth}>\n`;
        let id = slugify(text) || 'section';
        for (let n = 2; used.has(id); n++) id = `${slugify(text)}-${n}`;
        used.add(id);
        return `<h2 id="${id}">${inner}</h2>\n`;
      },
    },
  });
  return { md, idFor: (text: string) => slugify(text) };
}

function extractFaq(tokens: Token[], md: Marked): FaqItem[] {
  const out: FaqItem[] = [];
  let question: string | null = null;
  let parts: string[] = [];
  let answerTokens: Token[] = [];
  const flush = () => {
    if (question && parts.length) {
      const answer: TokensList = Object.assign(answerTokens, { links: {} as Links });
      out.push({ question, answer: parts.join(' '), html: DOMPurify.sanitize(md.parser(answer)) });
    }
    question = null;
    parts = [];
    answerTokens = [];
  };
  for (const t of tokens) {
    if (t.type === 'heading') {
      flush();
      const h = t as Tokens.Heading;
      if (h.depth === 3 && h.text.trim().endsWith('?')) question = plainText(h.text);
      continue;
    }
    if (!question) continue;
    if (t.type === 'paragraph') parts.push(plainText((t as Tokens.Paragraph).text));
    if (t.type === 'list') {
      parts.push((t as Tokens.List).items.map((i) => plainText(i.text)).join('; '));
    }
    if (t.type !== 'space') answerTokens.push(t);
  }
  flush();
  return out;
}

/** Splits off a `## Frequently asked questions` section (up to the next `##`), if there is one. */
function splitFaqSection(tokens: Token[]): { body: Token[]; faq: Token[] | null } {
  const start = tokens.findIndex(
    (t) => t.type === 'heading' && (t as Tokens.Heading).depth === 2 && FAQ_SECTION.test((t as Tokens.Heading).text.trim())
  );
  if (start < 0) return { body: tokens, faq: null };
  let end = tokens.findIndex(
    (t, i) => i > start && t.type === 'heading' && (t as Tokens.Heading).depth === 2
  );
  if (end < 0) end = tokens.length;
  return { body: [...tokens.slice(0, start), ...tokens.slice(end)], faq: tokens.slice(start + 1, end) };
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function build(files: Record<string, string>, kind: ContentKind): ContentEntry[] {
  return Object.entries(files)
    .map(([file, raw]) => {
      const slug = file.split('/').pop()!.replace(/\.md$/, '');
      const { data, body } = parseFrontMatter(raw);
      const { md, idFor } = markdownFor();
      const all = md.lexer(body);
      const { body: bodyTokens, faq: faqTokens } = splitFaqSection(all);
      const html = DOMPurify.sanitize(md.parser(Object.assign(bodyTokens, { links: all.links })));
      const seen = new Map<string, number>();
      const toc = bodyTokens
        .filter((t): t is Tokens.Heading => t.type === 'heading' && (t as Tokens.Heading).depth === 2)
        .map((h) => {
          const base = idFor(h.text) || 'section';
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          return { id: n === 1 ? base : `${base}-${n}`, text: plainText(h.text) };
        });
      const wordCount = plainText(body.replace(/^#+\s.*$/gm, '')).split(' ').filter(Boolean).length;
      const updated = data.updated || '';
      return {
        kind,
        slug,
        path: kind === 'guide' ? `/guides/${slug}` : `/${slug}`,
        title: data.title || slug,
        description: data.description || '',
        heading: data.heading || data.title || slug,
        published: data.published || updated,
        updated,
        topic: data.topic || '',
        related: list(data.related),
        audience: data.audience || '',
        author: data.author || '',
        authorRole: data.authorRole || '',
        reviewer: data.reviewer || '',
        reviewerRole: data.reviewerRole || '',
        html,
        toc,
        wordCount,
        readingMinutes: Math.max(1, Math.round(wordCount / 220)),
        faq: extractFaq(faqTokens ?? all, md),
        faqSection: faqTokens !== null,
      };
    })
    .sort((a, b) => a.heading.localeCompare(b.heading));
}

export const CONTENT_PAGES: ContentEntry[] = build(pageFiles, 'page');
export const GUIDES: ContentEntry[] = build(guideFiles, 'guide');

const BY_PATH = new Map([...CONTENT_PAGES, ...GUIDES].map((e) => [e.path, e]));

export function contentForPath(pathname: string): ContentEntry | undefined {
  return BY_PATH.get(pathname);
}

/** Order of the sections on /guides; guides with any other topic go last. */
export const GUIDE_TOPICS = ['Starting your search', 'Meeting someone', 'Faith and family', 'Staying safe'];

/** Up to three guides to read next: the `related` list first, then the same topic, then the rest. */
export function relatedGuides(entry: ContentEntry, count = 3): ContentEntry[] {
  const bySlug = new Map(GUIDES.map((g) => [g.slug, g]));
  const picked: ContentEntry[] = [];
  const add = (g: ContentEntry | undefined) => {
    if (g && g.path !== entry.path && !picked.includes(g)) picked.push(g);
  };
  entry.related.forEach((s) => add(bySlug.get(s)));
  GUIDES.filter((g) => entry.topic && g.topic === entry.topic).forEach(add);
  GUIDES.forEach(add);
  return picked.slice(0, count);
}
