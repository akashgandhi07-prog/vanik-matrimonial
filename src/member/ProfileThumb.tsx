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
    return (
      <div
        className={className}
        role="img"
        aria-label={alt}
        style={{
          aspectRatio: '1',
          background: '#f3f4f6',
          borderRadius: 8,
        }}
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
