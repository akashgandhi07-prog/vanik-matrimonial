/** Strip HTML / script — server-side text sanitisation for free-text fields */
export function stripHtml(input: string | null | undefined, maxLen?: number): string {
  if (input == null) return '';
  let s = String(input).replace(/<[^>]*>/g, '');
  s = s.replace(/[<>'"&]/g, (c) => {
    const map: Record<string, string> = {
      '<': '',
      '>': '',
      "'": '',
      '"': '',
      '&': '',
    };
    return map[c] ?? c;
  });
  s = s.trim();
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
