import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_DESCRIPTION, SITE_NAME, canonicalUrl, pageMetaFor } from '../lib/pageMeta';

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
 * Keeps title, description, robots and canonical in sync with the route after client-side
 * navigation. Crawlers get the same values in each page's static HTML (scripts/prerender.mjs).
 */
export function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = pageMetaFor(pathname);
    document.title = meta?.title ?? SITE_NAME;
    setMetaTag('description', meta?.description ?? (meta?.indexable ? DEFAULT_DESCRIPTION : null));
    if (meta?.indexable) {
      setMetaTag('robots', null);
      setCanonical(canonicalUrl(pathname));
    } else {
      setMetaTag('robots', 'noindex');
      setCanonical(null);
    }
  }, [pathname]);

  return null;
}
