/**
 * Turns Supabase Storage failures into something a member can act on. Raw storage text (RLS policy
 * names, bucket names, "object exceeded the maximum allowed size") is confusing mid-registration,
 * which is exactly where people give up.
 */
export function friendlyUploadError(err: unknown, kind: 'photo' | 'id'): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const m = raw.toLowerCase();
  const thing = kind === 'photo' ? 'photo' : 'proof of identity';

  if (m.includes('exceeded') || m.includes('too large') || m.includes('413') || m.includes('payload')) {
    return `That ${thing} is too large. Please choose a smaller image, or take a new photo at a lower quality setting.`;
  }
  if (m.includes('row-level security') || m.includes('unauthorized') || m.includes('jwt') || m.includes('401')) {
    return `Your session has expired. Please sign in again, then re-upload your ${thing}.`;
  }
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('timeout') || m.includes('load failed')) {
    return `Your ${thing} could not be uploaded - please check your connection and try again.`;
  }
  if (m.includes('mime') || m.includes('content type') || m.includes('format') || m.includes('invalid')) {
    return kind === 'photo'
      ? 'That file type is not supported. Please upload a JPG or PNG photo.'
      : 'That file type is not supported. Please upload a JPG or PNG image of your proof of identity.';
  }
  return `Your ${thing} could not be uploaded. Please try again, or use a different image.`;
}
