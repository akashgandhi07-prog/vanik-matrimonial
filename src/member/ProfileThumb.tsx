import { useEffect, useMemo, useState } from 'react';
import { fetchPhotoSignedUrl, fetchProfilePhotoSignedUrls } from '../lib/supabase';

function fallbackAvatarUrl(firstName: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}&size=300&background=e8d5c4&color=7c4a2d&font-size=0.38&bold=true&format=svg`;
}

/** Single fetch for profile modal header + full-screen lightbox (avoids duplicate signed-URL requests). */
export function useProfilePhotoDisplayUrl(profileId: string, firstName: string, enabled: boolean): string | null {
  const fallback = useMemo(() => fallbackAvatarUrl(firstName), [firstName]);
  const [signed, setSigned] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchPhotoSignedUrl(profileId).then((u) => {
      if (alive && u) setSigned(u);
    });
    return () => {
      alive = false;
    };
  }, [profileId, enabled]);

  if (!enabled) return null;
  return signed ?? fallback;
}

/** Gallery URLs for the profile modal (ordered); falls back to avatar while loading or if none returned. */
export function useProfilePhotoDisplayUrls(profileId: string, firstName: string, enabled: boolean): string[] {
  const fallback = useMemo(() => fallbackAvatarUrl(firstName), [firstName]);
  const [signed, setSigned] = useState<string[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchProfilePhotoSignedUrls(profileId).then((urls) => {
      if (!alive) return;
      setSigned(urls.length > 0 ? urls : []);
    });
    return () => {
      alive = false;
    };
  }, [profileId, enabled]);

  return useMemo(() => {
    if (!enabled) return [];
    if (signed === null) return [fallback];
    return signed.length > 0 ? signed : [fallback];
  }, [enabled, signed, fallback]);
}

export function ProfileThumb({
  profileId,
  firstName,
  className,
  anonymous = false,
  /** When set, skips fetch; parent should use {@link useProfilePhotoDisplayUrl}. */
  controlledSrc,
  /** `contain` fits the full image (e.g. modal header); `cover` fills a square crop. */
  imageFit = 'cover',
}: {
  profileId: string;
  firstName: string;
  className?: string;
  anonymous?: boolean;
  controlledSrc?: string;
  imageFit?: 'cover' | 'contain';
}) {
  const [src, setSrc] = useState<string | null>(null);
  const isControlled = controlledSrc !== undefined;
  const alt = `${firstName}'s profile photo`;

  useEffect(() => {
    if (anonymous || isControlled) return;
    let alive = true;
    fetchPhotoSignedUrl(profileId).then((u) => {
      if (alive && u) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [profileId, anonymous, isControlled]);

  if (anonymous) {
    return null;
  }

  const fallback = fallbackAvatarUrl(firstName);
  const displaySrc = isControlled ? controlledSrc! : src ?? fallback;

  const style =
    imageFit === 'cover'
      ? { width: '100%', aspectRatio: '1', objectFit: 'cover' as const, borderRadius: 8 }
      : { width: '100%', height: 'auto', maxHeight: '100%', objectFit: 'contain' as const, borderRadius: 0 };

  return <img src={displaySrc} alt={alt} className={className} style={style} />;
}
