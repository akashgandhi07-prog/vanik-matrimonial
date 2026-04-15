import { useEffect, useState } from 'react';
import { fetchPhotoSignedUrl } from '../lib/supabase';

export function ProfileThumb({
  profileId,
  firstName,
  className,
}: {
  profileId: string;
  firstName: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const alt = `${firstName}'s profile photo`;

  useEffect(() => {
    let alive = true;
    fetchPhotoSignedUrl(profileId).then((u) => {
      if (alive && u) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [profileId]);

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
