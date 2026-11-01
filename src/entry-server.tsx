/* eslint-disable react-refresh/only-export-components -- build-time entry, never hot-reloaded */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { AppRoutes } from './App';

/** Build-time only: used by scripts/prerender.mjs to write static HTML for public pages. */
export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <AppRoutes />
      </StaticRouter>
    </StrictMode>
  );
}

export { CONTENT_PAGES, GUIDES } from './content/content';
export { SITE_NAME, SITE_ORIGIN, canonicalUrl, pageMetaFor, prerenderPaths } from './lib/pageMeta';
export { structuredDataFor } from './lib/structuredData';
