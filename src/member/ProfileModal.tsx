import { useEffect } from 'react';
import { ProfileThumb } from './ProfileThumb';
import { cmToFeetInches } from '../lib/heights';
import type { ProfileRow } from './memberContext';

type Props = {
  candidate: ProfileRow;
  inTray: boolean;
  trayFull: boolean;
  blocked: boolean;
  bookmarked: boolean;
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
  inTray,
  trayFull,
  blocked,
  bookmarked,
  onClose,
  onToggleBookmark,
  onToggleTray,
}: Props) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="profile-modal-title"
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="card modal-panel"
        style={{ padding: 0, overflow: 'hidden', maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo header */}
        <div style={{ position: 'relative' }}>
          <ProfileThumb
            profileId={c.id}
            firstName={c.first_name}
            className="profile-modal-photo"
          />
          <button type="button" aria-label="Close profile" onClick={onClose} className="profile-modal-close">
            {'\u2715'}
          </button>
          <span className="badge badge-muted profile-modal-ref-badge">{c.reference_number}</span>
        </div>

        {/* Content */}
        <div className="profile-modal-body" style={{ padding: '20px 24px 24px' }}>
          <h2
            id="profile-modal-title"
            style={{ margin: '0 0 4px', fontSize: 22 }}
          >
            {c.first_name}{c.age ? `, ${c.age}` : ''}
          </h2>
          {c.job_title && (
            <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
              {c.job_title}
            </p>
          )}

          <Row label="Religion" value={c.religion} />
          <Row label="Community" value={c.community} />
          <Row label="Nationality" value={c.nationality} />
          <Row label="Place of birth" value={c.place_of_birth} />
          <Row label="Family origin" value={c.town_country_of_origin} />
          <Row label="Diet" value={c.diet} />
          <Row label="Height" value={heightDisplay} />
          <Row label="Education" value={c.education} />
          <Row label="Settlement plans" value={c.future_settlement_plans} />

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
            <button
              type="button"
              className="btn btn-primary"
              disabled={blocked || (!inTray && trayFull)}
              title={
                blocked
                  ? 'Already requested within 6 months'
                  : !inTray && trayFull
                  ? 'Tray is full. Submit or remove a candidate first.'
                  : undefined
              }
              onClick={onToggleTray}
            >
              {blocked
                ? '✓ Already requested'
                : inTray
                ? '✕ Remove from request'
                : 'Request contact details'}
            </button>
          </div>
          {blocked && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-warning)' }}>
              You have already requested this person's details within the last 6 months.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
