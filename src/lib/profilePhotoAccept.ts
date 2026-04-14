const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);

function extIsJpgOrPng(name: string): boolean {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return e === 'jpg' || e === 'jpeg' || e === 'png';
}

/** Reject non–JPG/PNG uploads. Returns a user-facing message or null if OK. */
export function rejectReasonIfNotJpegOrPng(file: File): string | null {
  const t = (file.type || '').toLowerCase().trim();
  if (ALLOWED_TYPES.has(t)) return null;
  // Some browsers leave type empty; allow only when the filename clearly matches.
  if (!t && extIsJpgOrPng(file.name)) return null;
  return 'Please use a JPG or PNG photo only.';
}
