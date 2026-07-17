// Some members fill in free-text fields entirely in capitals (e.g. "LONDON",
// "BRITISH"). These helpers re-case a value only when it contains no lowercase
// letters at all — deliberate mixed case is always left untouched.

const KEEP_UPPER = new Set(['UK', 'GB', 'US', 'USA', 'UAE', 'EU', 'NHS', 'IT', 'HR']);

const SPECIAL_CASE: Record<string, string> = {
  BSC: 'BSc',
  MSC: 'MSc',
  PHD: 'PhD',
  MPHIL: 'MPhil',
};

// Joining words kept lowercase inside place names ("Newcastle upon Tyne").
const SMALL_WORDS = new Set(['of', 'the', 'and', 'on', 'upon', 'in', 'at', 'by', 'de', 'la', 'le', 'von', 'van']);

function isAllCaps(value: string): boolean {
  return /[A-Z]/.test(value) && !/[a-z]/.test(value);
}

function recaseWord(word: string, isFirst: boolean): string {
  const upper = word.toUpperCase();
  if (KEEP_UPPER.has(upper)) return upper;
  if (SPECIAL_CASE[upper]) return SPECIAL_CASE[upper];
  if (!isFirst && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** "LONDON" -> "London", "NEWCASTLE UPON TYNE" -> "Newcastle upon Tyne". */
export function titleCaseIfAllCaps(value: string): string;
export function titleCaseIfAllCaps(value: string | null | undefined): string | null;
export function titleCaseIfAllCaps(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!isAllCaps(value)) return value;
  let first = true;
  return value.replace(/[A-Za-z]+/g, (word) => {
    const out = recaseWord(word, first);
    first = false;
    return out;
  });
}

/** For sentence-style fields (hobbies, plans): "I LOVE HIKING." -> "I love hiking." */
export function sentenceCaseIfAllCaps(value: string): string;
export function sentenceCaseIfAllCaps(value: string | null | undefined): string | null;
export function sentenceCaseIfAllCaps(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!isAllCaps(value)) return value;
  let out = value.toLowerCase();
  out = out.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
  out = out.replace(/\b[a-z]+\b/g, (word) => {
    const upper = word.toUpperCase();
    if (upper === 'I') return 'I';
    if (KEEP_UPPER.has(upper)) return upper;
    if (SPECIAL_CASE[upper]) return SPECIAL_CASE[upper];
    return word;
  });
  return out;
}
