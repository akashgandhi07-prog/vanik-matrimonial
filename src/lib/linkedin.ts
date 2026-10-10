/**
 * Normalise a member-typed LinkedIn link to https://www.linkedin.com/in/<handle>.
 *
 * Accepts the forms people paste: with or without https://, www. or a country
 * subdomain (uk.linkedin.com), trailing slash, query string or tracking params.
 * Only personal profile links (/in/...) are accepted, matching the DB CHECK on
 * member_private.linkedin_url. Keep in step with supabase/functions/_shared/linkedin.ts.
 *
 * Returns '' for blank input, null when the input is not a LinkedIn profile link.
 */
export function normalizeLinkedInUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !/^[a-z]{2,3}\.linkedin\.com$/.test(host)) return null;
  const m = /^\/in\/([^/?#\s]{3,100})\/?$/.exec(url.pathname);
  if (!m) return null;
  return `https://www.linkedin.com/in/${m[1]}`;
}

/** Short form for display: linkedin.com/in/<handle>. */
export function linkedInDisplay(url: string): string {
  return url.replace(/^https:\/\/www\./, '');
}
