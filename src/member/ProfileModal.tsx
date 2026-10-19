import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useProfilePhotoDisplayUrls } from './ProfileThumb';
import { cmToFeetInches } from '../lib/heights';
import { titleCaseIfAllCaps, sentenceCaseIfAllCaps } from '../lib/displayCase';
import type { ProfileRow } from './memberContext';
import { linkedInDisplay } from '../lib/linkedin';
import { dietLabel, religionLabel, telHref } from '../lib/profileLabels';
import { whatsappUrlFromPhone } from '../lib/whatsapp';

type Props = {
  candidate: ProfileRow;
  contactDetails?: {
    mobile?: string | null;
    linkedin_url?: string | null;
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
  /** When false, hides the “open from Browse to request” footnote (e.g. My Requests already has the workflow). */
  showRequestFromBrowseHint?: boolean;
  onClose: () => void;
  onToggleBookmark: () => void;
  onToggleTray: () => void;
};

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
  showRequestFromBrowseHint = true,
  onClose,
  onToggleBookmark,
  onToggleTray,
}: Props) {
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [copied, setCopied] = useState(false);
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

  const subline = [c.job_title ? titleCaseIfAllCaps(c.job_title) : null, c.place_of_birth ? titleCaseIfAllCaps(c.place_of_birth) : null]
    .filter(Boolean)
    .join(' · ');

  const chips = [
    religionLabel(c.religion),
    dietLabel(c.diet),
    c.height_cm ? `${cmToFeetInches(c.height_cm)} (${c.height_cm} cm)` : null,
  ].filter((v): v is string => !!v);

  const details = [
    { label: 'Nationality', value: c.nationality ? titleCaseIfAllCaps(c.nationality) : null },
    { label: 'Family origin', value: c.town_country_of_origin ? titleCaseIfAllCaps(c.town_country_of_origin) : null },
    { label: 'Education', value: c.education ? titleCaseIfAllCaps(c.education) : null },
    { label: 'Plans to settle', value: c.future_settlement_plans ? sentenceCaseIfAllCaps(c.future_settlement_plans) : null },
  ].filter((d): d is { label: string; value: string } => !!d.value);

  const whatsappUrl = contactDetails?.mobile ? whatsappUrlFromPhone(contactDetails.mobile) : null;

  async function copyNumber(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); the number is still shown and tappable.
    }
  }

  const displayTitle = anonymous
    ? ([c.gender, c.age ? `Age ${c.age}` : null].filter(Boolean).join(' · ') || 'Profile')
    : `${titleCaseIfAllCaps(c.first_name)}${c.age ? `, ${c.age}` : ''}`;

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
        style={{ padding: 0 }}
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
                <img src={currentPhotoUrl} alt={`${c.first_name}'s profile photo`} className="profile-modal-photo" />
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

          <div className="profile-modal-body">
            <header className="profile-modal-header">
              {!anonymous && currentPhotoUrl && (
                // Phones get a compact photo here instead of the media column (hidden by CSS).
                <button
                  type="button"
                  className="profile-modal-avatar"
                  aria-label={
                    hasMultiPhotos ? `View ${gallerySize} photos full size` : 'View photo full size'
                  }
                  onClick={() => setPhotoLightboxOpen(true)}
                >
                  <img src={currentPhotoUrl} alt="" />
                  {hasMultiPhotos && (
                    <span className="profile-modal-avatar-count" aria-hidden>
                      {safeIndex + 1}/{gallerySize}
                    </span>
                  )}
                </button>
              )}
              <div className="profile-modal-heading">
                <h2 id="profile-modal-title">{displayTitle}</h2>
                {subline && <p className="profile-modal-subline">{subline}</p>}
                <span className="profile-modal-verified">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path
                      d="M3.5 8.5l3 3 6-6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Verified
                </span>
              </div>
            </header>

            {anonymous && (
              <p className="profile-modal-hint">
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

            {(contactDetails?.mobile || contactDetails?.linkedin_url) && (
              <section className="profile-modal-contact" aria-label="Contact details">
                <div className="profile-modal-contact-actions">
                  {contactDetails.mobile && (
                    <a className="profile-modal-contact-btn profile-modal-contact-btn--call" href={telHref(contactDetails.mobile)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                      </svg>
                      Call
                    </a>
                  )}
                  {whatsappUrl && (
                    <a
                      className="profile-modal-contact-btn profile-modal-contact-btn--whatsapp"
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5z" />
                      </svg>
                      WhatsApp
                    </a>
                  )}
                  {contactDetails.linkedin_url && (
                    <a
                      className="profile-modal-contact-btn"
                      href={contactDetails.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={linkedInDisplay(contactDetails.linkedin_url)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <rect x="3" y="7" width="18" height="13" rx="2" />
                        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      LinkedIn
                    </a>
                  )}
                </div>
                {contactDetails.mobile && (
                  <div className="profile-modal-contact-number">
                    <a href={telHref(contactDetails.mobile)}>{contactDetails.mobile}</a>
                    <button type="button" className="profile-modal-link-btn" onClick={() => void copyNumber(contactDetails.mobile!)}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </section>
            )}

            {chips.length > 0 && (
              <ul className="profile-modal-chips" aria-label="At a glance">
                {chips.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
            )}

            {c.hobbies && (
              <section className="profile-modal-section">
                <h3>Hobbies and interests</h3>
                <p>{sentenceCaseIfAllCaps(c.hobbies)}</p>
              </section>
            )}

            {details.length > 0 && (
              <dl className="profile-modal-details">
                {details.map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd>{d.value}</dd>
                  </div>
                ))}
              </dl>
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
            {allowRequestAction && !blocked && (
              <p className="profile-modal-footnote">
                A request is a two-way introduction. When you submit, this member is emailed straight away to say you
                asked, and given your name, profile and contact details. You get theirs at the same time.
              </p>
            )}
            {!allowRequestAction && showRequestFromBrowseHint && (
              <p className="profile-modal-footnote">
                To request contact details, open this profile from Browse and add it to your request tray.
              </p>
            )}
            {blocked && allowRequestAction && (
              <p className="profile-modal-footnote" style={{ color: 'var(--color-warning)' }}>
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
