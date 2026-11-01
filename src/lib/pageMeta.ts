import { CONTENT_PAGES, GUIDES, contentForPath, type ContentEntry } from '../content/content';

export const SITE_ORIGIN = 'https://matrimonial.vanikcouncil.uk';
export const SITE_NAME = 'Vanik Matrimonial Register';

export const DEFAULT_DESCRIPTION =
  'A private, not-for-profit matrimonial introduction service for Gujarati Hindu and Jain families in the UK, run by Vanik Council volunteers for over 40 years. Membership £10 a year.';

export type PageMeta = {
  title: string;
  description?: string;
  /** Only indexable pages get a canonical URL; everything else is noindexed. */
  indexable?: boolean;
  /** Last meaningful edit (YYYY-MM-DD), for the sitemap. */
  updated?: string;
  content?: ContentEntry;
  /** Social preview image, when the page has its own (1200x675 PNG). */
  image?: string;
};

const STATIC_PAGE_META: Record<string, PageMeta> = {
  '/': {
    title: 'Vanik Matrimonial Register - Gujarati Hindu & Jain Introductions UK',
    description: DEFAULT_DESCRIPTION,
    indexable: true,
  },
  '/register': {
    title: `Register - ${SITE_NAME}`,
    description:
      'Join the Vanik Matrimonial Register for £10 a year. Applications are verified by Vanik Council volunteers within 2 working days.',
    indexable: true,
  },
  '/demo': {
    title: `Browse Profiles - ${SITE_NAME}`,
    description:
      'Preview verified matrimonial profiles from Gujarati Hindu and Jain families before you register. Full profiles and introductions are available to approved members.',
    indexable: true,
  },
  '/privacy': {
    title: `Privacy Policy - ${SITE_NAME}`,
    description:
      'How the Vanik Matrimonial Register protects your data. Contact details are shared only inside the member dashboard and never displayed publicly.',
    indexable: true,
  },
  '/login': {
    title: `Sign in - ${SITE_NAME}`,
  },
  '/whats-new': {
    title: `What's New - ${SITE_NAME}`,
    description:
      'Recent improvements to the Vanik Matrimonial Register, in plain English. Many changes come straight from member feedback.',
    indexable: true,
  },
  '/guides': {
    title: `Guides for Gujarati and Jain Singles and Parents - ${SITE_NAME}`,
    description:
      'Practical, friendly guides on finding a life partner: writing your profile, first meetings, questions to ask, staying safe and helping as a parent.',
    indexable: true,
  },
};

export function pageMetaFor(pathname: string): PageMeta | undefined {
  const fixed = STATIC_PAGE_META[pathname];
  if (fixed) return fixed;
  const entry = contentForPath(pathname);
  if (!entry) return undefined;
  return {
    title: `${entry.title} - ${SITE_NAME}`,
    description: entry.description,
    indexable: true,
    updated: entry.updated || undefined,
    content: entry,
    image: entry.kind === 'guide' ? guideImageUrl(entry.slug) : undefined,
  };
}

/** Every page that is prerendered to static HTML and listed in the sitemap. */
export function prerenderPaths(): string[] {
  return [
    ...Object.entries(STATIC_PAGE_META)
      .filter(([, m]) => m.indexable)
      .map(([p]) => p),
    ...CONTENT_PAGES.map((e) => e.path),
    ...GUIDES.map((e) => e.path),
  ];
}

/** Per-guide image made by `npm run guide-images` into public/images/guides. */
export function guideImageUrl(slug: string): string {
  return `${SITE_ORIGIN}/images/guides/${slug}.png`;
}

export function canonicalUrl(pathname: string): string {
  return `${SITE_ORIGIN}${pathname === '/' ? '/' : pathname}`;
}
