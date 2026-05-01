import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ProfileThumb, useProfilePhotoDisplayUrls } from './ProfileThumb';
import { cmToFeetInches } from '../lib/heights';
import type { ProfileRow } from './memberContext';

type Props = {
  candidate: ProfileRow;
  contactDetails?: {
    mobile?: string | null;
  };
  /** When true the modal is opened before contact details are shared (browse/saved). No photo is shown; title is anonymous. */
  anonymous?: boolean;
  inTray: boolean;
  trayFull: boolean;
  /** Max profiles allowed in the tray (0-3). Used for clearer “full” tooltips when limits are below 3. */
  trayCapacity?: number;
  /** When true, adding to the tray is blocked until outstanding feedback is submitted (server rule). */
  feedbackRequiredBeforeRequests?: boolean;
  blocked: boolean;
  bookmarked: boolean;
  allowRequestAction?: boolean;
  onClose: () => void;
  onToggleBookmark: () => void;
  onToggleTray: () => void;
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="profile-modal-kv">
      <span className="profile-modal-kv-label">{label}</span>
      <span className="profile-modal-kv-value">{value}</span>
    </div>
  );
}

export function ProfileModal({
  candidate: c,
  contactDetails,
  anonymous = false,
  inTray,
  trayFull,
  trayCapacity,
  feedbackRequiredBeforeRequests = false,
  blocked,
  bookmarked,
  allowRequestAction = true,
  onClose,
  onToggleBookmark,
  onToggleTray,
}: Props) {
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const photoUrls = useProfilePhotoDisplayUrls(c.id, c.first_name, !anonymous);
  const gallerySize = !anonymous ? photoUrls.length : 0;
  const hasMultiPhotos = gallerySize > 1;
  const safeIndex = gallerySize > 0 ? Math.min(photoIndex, gallerySize - 1) : 0;
  const currentPhotoUrl = !anonymous ? photoUrls[safeIndex] : null;

  const goPrevPhoto = useCallback(
    (e?: MouseEvent) => {
      e?.stopPropagation();
      if (gallerySize <= 1) return;
      setPhotoIndex((i) => (i - 1 + gallerySize) % gallerySize);
    },
    [gallerySize]
  );

  const goNextPhoto = useCallback(
    (e?: MouseEvent) => {
      e?.stopPropagation();
      if (gallerySize <= 1) return;
      setPhotoIndex((i) => (i + 1) % gallerySize);
    },
    [gallerySize]
  );

  useEffect(() => {
    setPhotoIndex(0);
  }, [c.id]);

  useEffect(() => {
    if (photoIndex >= gallerySize && gallerySize > 0) {
      setPhotoIndex(0);
    }
  }, [photoIndex, gallerySize]);

  // Close on Escape (lightbox first, then modal); arrow keys cycle photos when gallery has multiple.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (photoLightboxOpen) {
          setPhotoLightboxOpen(false);
          return;
        }
        onClose();
        return;
      }
      if (!hasMultiPhotos) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrevPhoto();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNextPhoto();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, photoLightboxOpen, hasMultiPhotos, goPrevPhoto, goNextPhoto]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const heightDisplay = c.height_cm
    ? `${c.height_cm} cm (${cmToFeetInches(c.height_cm)})`
    : null;

  const displayTitle = anonymous
    ? ([c.gender, c.age ? `Age ${c.age}` : null].filter(Boolean).join(' · ') || 'Profile')
    : `${c.first_name}${c.age ? `, ${c.age}` : ''}`;

  const requestTrayTitle =
    blocked
      ? "You already have this member's details in My requests"
      : !inTray && feedbackRequiredBeforeRequests
        ? 'Submit outstanding feedback under My requests (introductions older than 21 days) before adding new requests.'
        : !inTray && trayFull
          ? trayCapacity === 0
            ? 'No request slots left this week or month. Check the numbers at the top of Browse.'
            : trayCapacity != null && trayCapacity < 3
              ? `Tray holds up to ${trayCapacity} right now (see the 7-day and month limits on Browse). Remove someone or wait for a reset.`
              : 'Tray is full. Submit or remove someone first.'
          : undefined;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="profile-modal-title"
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="card modal-panel profile-modal-panel"
        style={{ padding: 0, maxWidth: 920 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Close profile" onClick={onClose} className="profile-modal-close">
          {'\u2715'}
        </button>

        <div className={`profile-modal-layout${anonymous ? ' profile-modal-layout--anonymous' : ''}`}>
          {!anonymous && currentPhotoUrl && (
            <div
              className="profile-modal-media"
              role="region"
              aria-roledescription="carousel"
              aria-label="Profile photos"
            >
              <button
                type="button"
                className="profile-modal-photo-trigger"
                aria-label={
                  hasMultiPhotos
                    ? `View full-size photo (${safeIndex + 1} of ${gallerySize})`
                    : 'View full-size photo'
                }
                onClick={() => setPhotoLightboxOpen(true)}
              >
                <ProfileThumb
                  profileId={c.id}
                  firstName={c.first_name}
                  className="profile-modal-photo"
                  anonymous={false}
                  controlledSrc={currentPhotoUrl}
                  imageFit="contain"
                />
              </button>
              {hasMultiPhotos && (
                <>
                  <button
                    type="button"
                    className="profile-modal-carousel-btn profile-modal-carousel-btn--prev"
                    aria-label="Previous photo"
                    onClick={goPrevPhoto}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="profile-modal-carousel-btn profile-modal-carousel-btn--next"
                    aria-label="Next photo"
                    onClick={goNextPhoto}
                  >
                    ›
                  </button>
                  <div className="profile-modal-carousel-dots">
                    {photoUrls.map((_, i) => (
                      <button
                        key={`${c.id}-photo-dot-${i}`}
                        type="button"
                        className={`profile-modal-carousel-dot${i === safeIndex ? ' is-active' : ''}`}
                        aria-label={`Show photo ${i + 1} of ${gallerySize}`}
                        aria-current={i === safeIndex ? 'true' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhotoIndex(i);
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="profile-modal-body" style={{ padding: '20px 24px 24px' }}>
            <h2
              id="profile-modal-title"
              style={{ margin: '0 0 4px', fontSize: 22 }}
            >
              {displayTitle}
            </h2>
            {c.job_title && (
              <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
                {c.job_title}
              </p>
            )}
            {anonymous && (
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>
                {blocked ? (
                  <>
                    Their photo is visible when you open this person under{' '}
                    <Link to="/dashboard/requests" state={{ focusProfileId: c.id }} style={{ fontWeight: 600, color: 'inherit' }}>
                      My requests
                    </Link>
                    .
                  </>
                ) : (
                  <>Profile photos are only shown after you request their details; they then appear under My requests.</>
                )}
              </p>
            )}

            <Row label="Religion" value={c.religion} />
            <Row label="Nationality" value={c.nationality} />
            <Row label="Location" value={c.place_of_birth} />
            <Row label="Family origin" value={c.town_country_of_origin} />
            <Row label="Diet" value={c.diet} />
            <Row label="Height" value={heightDisplay} />
            <Row label="Education" value={c.education} />
            <Row label="Settlement plans" value={c.future_settlement_plans} />
            {/* Contact details - only shown when the user has already received them (My Requests view) */}
            {contactDetails?.mobile && <Row label="Phone" value={contactDetails.mobile} />}

            {c.hobbies && (
              <div style={{ padding: '8px 0' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Hobbies &amp; interests
                </p>
                <p style={{ margin: 0, fontSize: 14 }}>{c.hobbies}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="profile-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onToggleBookmark}>
                {bookmarked ? '★ Saved' : '☆ Save profile'}
              </button>
              {allowRequestAction ? (
                blocked ? (
                  <Link
                    to="/dashboard/requests"
                    state={{ focusProfileId: c.id }}
                    className="btn btn-primary"
                    style={{ textAlign: 'center', textDecoration: 'none' }}
                    onClick={onClose}
                  >
                    Already requested
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!inTray && (trayFull || feedbackRequiredBeforeRequests)}
                    title={requestTrayTitle}
                    onClick={onToggleTray}
                  >
                    {inTray ? '✕ Remove from request' : 'Request contact details'}
                  </button>
                )
              ) : null}
            </div>
            {!allowRequestAction && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                To request contact details, open this profile from Browse and add it to your request tray.
              </p>
            )}
            {blocked && allowRequestAction && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-warning)' }}>
                You already requested this profile. Use the button above to open their card in My requests (photo and
                contacts).
              </p>
            )}
          </div>
        </div>
      </div>

      {!anonymous && photoLightboxOpen && currentPhotoUrl && (
        <div
          className="profile-photo-lightbox"
          role="dialog"
          aria-modal
          aria-label="Full-size profile photo"
          onClick={() => setPhotoLightboxOpen(false)}
        >
          <button
            type="button"
            className="profile-photo-lightbox-close"
            aria-label="Close full-size photo"
            onClick={() => setPhotoLightboxOpen(false)}
          >
            {'\u2715'}
          </button>
          {hasMultiPhotos && (
            <>
              <button
                type="button"
                className="profile-photo-lightbox-nav profile-photo-lightbox-nav--prev"
                aria-label="Previous photo"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrevPhoto();
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="profile-photo-lightbox-nav profile-photo-lightbox-nav--next"
                aria-label="Next photo"
                onClick={(e) => {
                  e.stopPropagation();
                  goNextPhoto();
                }}
              >
                ›
              </button>
            </>
          )}
          <div className="profile-photo-lightbox-frame" onClick={(e) => e.stopPropagation()}>
            <img src={currentPhotoUrl} alt="" className="profile-photo-lightbox-img" />
            <div className="profile-photo-lightbox-overlay" aria-hidden>
              <span className="profile-photo-lightbox-name">{displayTitle}</span>
              {hasMultiPhotos && (
                <span className="profile-photo-lightbox-counter">
                  {safeIndex + 1} / {gallerySize}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
