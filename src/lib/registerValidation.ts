/** Strip common separators for phone comparison. */
export function normalizeUkPhone(raw: string): string {
  return raw.replace(/[\s().-]/g, '');
}

/** UK mobile: 07… or +447… (10 digits after 7). */
export function isValidUkMobile(raw: string): boolean {
  const n = normalizeUkPhone(raw);
  if (/^\+447\d{9}$/.test(n)) return true;
  if (/^07\d{9}$/.test(n)) return true;
  return false;
}

/**
 * UK postcode (incl. London, GIR 0AA). Accepts with or without space before inward code.
 */
export function isValidUkPostcode(raw: string): boolean {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!compact) return false;
  return /^([A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}|GIR0A{2})$/.test(compact);
}

/** Person or family name: letters (any script), space, hyphen, apostrophe, period. */
const NAME_PATTERN = /^[\p{L}][\p{L}\s'.-]{0,79}$/u;

export function isValidPersonName(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && NAME_PATTERN.test(t);
}

/** Town, country, nationality — allows digits and comma for “City, Country”. */
const PLACE_PATTERN = /^[\p{L}0-9\s,.'()/-]{2,200}$/u;

export function isValidPlaceField(s: string, maxLen: number): boolean {
  const t = s.trim();
  return t.length >= 2 && t.length <= maxLen && PLACE_PATTERN.test(t);
}

export function isValidOptionalWeight(raw: string): boolean {
  if (!raw.trim()) return true;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30 && n <= 200;
}
