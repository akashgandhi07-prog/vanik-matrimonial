/** 4'8" (56in) through 6'6" (78in), 1-inch steps, cm rounded */
export const HEIGHT_OPTIONS: { label: string; cm: number }[] = (() => {
  const out: { label: string; cm: number }[] = [];
  for (let inches = 56; inches <= 78; inches++) {
    const cm = Math.round(inches * 2.54);
    const ft = Math.floor(inches / 12);
    const inch = inches % 12;
    out.push({ label: `${ft}'${inch}" (${cm} cm)`, cm });
  }
  return out;
})();

/** Min/max cm represented in profile height options (same range as the registration picker). */
export const HEIGHT_CM_MIN = HEIGHT_OPTIONS[0]!.cm;
export const HEIGHT_CM_MAX = HEIGHT_OPTIONS[HEIGHT_OPTIONS.length - 1]!.cm;

export function cmToFeetInches(cm: number | null | undefined): string {
  if (cm == null) return '-';
  const inches = Math.round(cm / 2.54);
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

export function formatHeightForFilter(cm: number, unit: 'cm' | 'ft'): string {
  return unit === 'cm' ? `${cm} cm` : cmToFeetInches(cm);
}
