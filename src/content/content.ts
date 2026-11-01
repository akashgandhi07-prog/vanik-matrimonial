import { marked, type Token, type Tokens } from 'marked';

/**
 * Public content pages and guides live as Markdown in `/content`. They are bundled at build time,
 * rendered to static HTML by `scripts/prerender.mjs` for crawlers, and rendered by React for visitors.
 */

export type ContentKind = 'page' | 'guide';

export type FaqItem = { question: string; answer: string };

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
  /** ISO date (YYYY-MM-DD) of the last meaningful edit. */
  updated: string;
  html: string;
  /** `###` questions and their answers, used for FAQPage structured data. */
  faq: FaqItem[];
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

function extractFaq(tokens: Token[]): FaqItem[] {
  const out: FaqItem[] = [];
  let question: string | null = null;
  let parts: string[] = [];
  const flush = () => {
    if (question && parts.length) out.push({ question, answer: parts.join(' ') });
    question = null;
    parts = [];
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
  }
  flush();
  return out;
}

function build(files: Record<string, string>, kind: ContentKind): ContentEntry[] {
  return Object.entries(files)
    .map(([file, raw]) => {
      const slug = file.split('/').pop()!.replace(/\.md$/, '');
      const { data, body } = parseFrontMatter(raw);
      const tokens = marked.lexer(body);
      return {
        kind,
        slug,
        path: kind === 'guide' ? `/guides/${slug}` : `/${slug}`,
        title: data.title || slug,
        description: data.description || '',
        heading: data.heading || data.title || slug,
        updated: data.updated || '',
        html: marked.parser(tokens),
        faq: extractFaq(tokens),
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
