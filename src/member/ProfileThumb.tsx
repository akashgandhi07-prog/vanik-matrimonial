import { useEffect, useState } from 'react';
import { fetchPhotoSignedUrl } from '../lib/supabase';

export function ProfileThumb({
  profileId,
  firstName,
  className,
  anonymous = false,
}: {
  profileId: string;
  firstName: string;
  className?: string;
  /** When true, no image is shown (browse-before-request flows - no placeholder). */
  anonymous?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const alt = `${firstName}'s profile photo`;

  useEffect(() => {
    if (anonymous) return;
    let alive = true;
    fetchPhotoSignedUrl(profileId).then((u) => {
      if (alive && u) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [profileId, anonymous]);

  if (anonymous) {
    return null;
  }

  if (!src) {
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}&size=300&background=e8d5c4&color=7c4a2d&font-size=0.38&bold=true&format=svg`;
    return (
      <img
        src={avatarUrl}
        alt={alt}
        className={className}
        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }}
    />
  );
}
