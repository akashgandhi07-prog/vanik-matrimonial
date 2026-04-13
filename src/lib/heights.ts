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

export function cmToFeetInches(cm: number | null | undefined): string {
  if (cm == null) return '—';
  const inches = Math.round(cm / 2.54);
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}
