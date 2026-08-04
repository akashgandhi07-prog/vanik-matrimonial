import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_ORIGIN = 'https://matrimonial.vanikcouncil.uk';
const SITE_NAME = 'Vanik Matrimonial Register';

const DEFAULT_DESCRIPTION =
  'A private, not-for-profit matrimonial introduction service for Hindu and Jain families in the UK, run by Vanik Council volunteers for over 40 years. Membership £10 a year.';

type PageMeta = {
  title: string;
  description?: string;
  /** Only indexable pages get a canonical URL; everything else is noindexed. */
  indexable?: boolean;
};

const PAGE_META: Record<string, PageMeta> = {
  '/': {
    title: 'Vanik Matrimonial Register - Hindu & Jain Introductions UK',
    description: DEFAULT_DESCRIPTION,
    indexable: true,
  },
  '/register': {
    title: `Register - ${SITE_NAME}`,
    description:
      'Join the Vanik Matrimonial Register for £10 a year. Applications are verified by Vanik Council volunteers within 10 working days.',
    indexable: true,
  },
  '/demo': {
    title: `Browse Profiles - ${SITE_NAME}`,
    description:
      'Preview verified matrimonial profiles from Hindu and Jain families before you register. Full profiles and introductions are available to approved members.',
    indexable: true,
  },
  '/privacy': {
    title: `Privacy Policy - ${SITE_NAME}`,
    description:
      'How the Vanik Matrimonial Register protects your data. Contact details are shared only inside the member dashboard and nothing is displayed publicly.',
    indexable: true,
  },
  '/login': {
    title: `Sign in - ${SITE_NAME}`,
  },
};

function setMetaTag(name: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Keeps title, description, robots and canonical in sync with the route.
 * index.html ships the homepage values statically for crawlers that do not
 * run JavaScript; this component takes over once the app mounts.
 */
export function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = PAGE_META[pathname];
    document.title = meta?.title ?? SITE_NAME;
    setMetaTag('description', meta?.description ?? (meta?.indexable ? DEFAULT_DESCRIPTION : null));
    if (meta?.indexable) {
      setMetaTag('robots', null);
      setCanonical(`${SITE_ORIGIN}${pathname === '/' ? '/' : pathname}`);
    } else {
      setMetaTag('robots', 'noindex');
      setCanonical(null);
    }
  }, [pathname]);

  return null;
}
