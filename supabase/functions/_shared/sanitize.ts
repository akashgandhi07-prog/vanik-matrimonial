/** Strip HTML / script — server-side text sanitisation for free-text fields.
 *
 * Removes HTML tags then collapses any residual angle brackets.
 * Apostrophes, quotes and ampersands are intentionally preserved because:
 *   - DB writes go through parameterised queries (no SQL injection risk).
 *   - Email body context (between tags, not in attributes) renders them fine.
 *   - Stripping them was corrupting legitimate names like "O'Brien".
 */
export function stripHtml(input: string | null | undefined, maxLen?: number): string {
  if (input == null) return '';
  // Remove all HTML tags first
  let s = String(input).replace(/<[^>]*>/g, '');
  // Belt-and-braces: collapse any residual angle brackets that survived tag stripping
  s = s.replace(/[<>]/g, '');
  s = s.trim();
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
