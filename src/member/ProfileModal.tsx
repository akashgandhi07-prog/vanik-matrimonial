import { useEffect, useState } from 'react';
import { ProfileThumb, useProfilePhotoDisplayUrl } from './ProfileThumb';
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
  const photoDisplayUrl = useProfilePhotoDisplayUrl(c.id, c.first_name, !anonymous);

  // Close on Escape (lightbox first, then modal)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (photoLightboxOpen) {
        setPhotoLightboxOpen(false);
        return;
      }
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, photoLightboxOpen]);

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
            ? 'No request slots left this week or month. Open My requests to see when limits reset.'
            : trayCapacity != null && trayCapacity < 3
              ? `You can only add up to ${trayCapacity} profile${trayCapacity === 1 ? '' : 's'} right now (weekly and monthly limits). Remove someone from the tray or wait for a reset.`
              : 'Tray is full. Submit or remove a candidate first.'
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
        style={{ padding: 0, maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo header (hidden when browsing anonymously - no placeholder) */}
        <div
          className={anonymous ? undefined : 'profile-modal-photo-wrap'}
          style={{ position: 'relative', minHeight: anonymous ? 44 : undefined }}
        >
          {!anonymous && photoDisplayUrl && (
            <button
              type="button"
              className="profile-modal-photo-trigger"
              aria-label="View full-size photo"
              onClick={() => setPhotoLightboxOpen(true)}
            >
              <ProfileThumb
                profileId={c.id}
                firstName={c.first_name}
                className="profile-modal-photo"
                anonymous={false}
                controlledSrc={photoDisplayUrl}
                imageFit="contain"
              />
            </button>
          )}
          <button type="button" aria-label="Close profile" onClick={onClose} className="profile-modal-close">
            {'\u2715'}
          </button>
        </div>

        {/* Content */}
        <div className="profile-modal-body" style={{ padding: '20px 24px 24px' }}>
          <h2
            id="profile-modal-title"
            style={{ margin: '0 0 4px', fontSize: 22 }}
          >
            {displayTitle}
          </h2>
          {!anonymous && c.job_title && (
            <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
              {c.job_title}
            </p>
          )}
          {anonymous && c.job_title && (
            <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
              {c.job_title}
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
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked || (!inTray && (trayFull || feedbackRequiredBeforeRequests))}
                title={requestTrayTitle}
                onClick={onToggleTray}
              >
                {blocked
                  ? '✓ Details available'
                  : inTray
                  ? '✕ Remove from request'
                  : 'Request contact details'}
              </button>
            ) : null}
          </div>
          {!allowRequestAction && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              To request contact details, open this profile from Browse and add it to your request tray.
            </p>
          )}
          {blocked && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-warning)' }}>
              You already requested this profile. Their details are available under My requests.
            </p>
          )}
        </div>
      </div>

      {!anonymous && photoLightboxOpen && photoDisplayUrl && (
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
          <div className="profile-photo-lightbox-frame" onClick={(e) => e.stopPropagation()}>
            <img src={photoDisplayUrl} alt="" className="profile-photo-lightbox-img" />
            <div className="profile-photo-lightbox-overlay" aria-hidden>
              <span className="profile-photo-lightbox-name">{displayTitle}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
