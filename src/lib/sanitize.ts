import DOMPurify from 'isomorphic-dompurify';

export function sanitizeText(input: string, maxLen?: number): string {
  const stripped = DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
  let s = stripped.trim();
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
