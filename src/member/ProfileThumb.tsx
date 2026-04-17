import { useEffect, useState } from 'react';
import { fetchPhotoSignedUrl } from '../lib/supabase';

function AnonymousPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        width: '100%',
        aspectRatio: '1',
        borderRadius: 8,
        background: '#e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '50%', height: '50%' }}
      >
        <circle cx="32" cy="22" r="12" fill="#9ca3af" />
        <path d="M8 56c0-13.255 10.745-24 24-24s24 10.745 24 24" fill="#9ca3af" />
      </svg>
    </div>
  );
}

export function ProfileThumb({
  profileId,
  firstName,
  className,
  anonymous = false,
}: {
  profileId: string;
  firstName: string;
  className?: string;
  /** When true, shows a generic silhouette — no photo is fetched and no name-based avatar is shown. */
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
    return <AnonymousPlaceholder className={className} />;
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
