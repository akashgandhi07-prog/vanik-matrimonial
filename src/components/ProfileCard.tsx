import type { ReactNode } from 'react';
import { sentenceCaseIfAllCaps, titleCaseIfAllCaps } from '../lib/displayCase';
import { dietLabel, religionLabel } from '../lib/profileLabels';

export type ProfileCardProps = {
  age?: number | null;
  gender?: string | null;
  profession?: string | null;
  height?: string | null;
  diet?: string | null;
  location?: string | null;
  religion?: string | null;
  nationality?: string | null;
  /** Education summary shown as a brief snippet on the card. */
  education?: string | null;
  /** Hobbies & interests snippet so personality comes through in anonymous browse. */
  hobbies?: string | null;
  /** Free-text "Future settlement plans" (e.g. "Want to stay in London"). */
  settlement?: string | null;
  /** Optional badge when a profile joined recently. */
  isNew?: boolean;
  /** Click handler for the whole card (e.g. open detail). */
  onOpen?: () => void;
  /** Action buttons rendered at the foot of the card. */
  actions?: ReactNode;
  /** Optional note shown beneath the actions. */
  note?: ReactNode;
};

export default function ProfileCard({
  age,
  gender,
  profession,
  height,
  diet,
  location,
  religion,
  nationality,
  education,
  hobbies,
  settlement,
  isNew,
  onOpen,
  actions,
  note,
}: ProfileCardProps) {
  const job = profession ? titleCaseIfAllCaps(profession) : null;
  const title = job ? (age != null ? `${job}, ${age}` : job) : age != null ? `Age ${age}` : 'Member';
  const subline = [location ? titleCaseIfAllCaps(location) : null, gender].filter(Boolean).join(' · ');
  const tags = [
    religionLabel(religion),
    dietLabel(diet),
    height,
    nationality ? titleCaseIfAllCaps(nationality) : null,
  ].filter((t): t is string => !!t);
  const educationText = education?.trim() ? titleCaseIfAllCaps(education.trim()) : null;
  const hobbiesText = hobbies?.trim() ? sentenceCaseIfAllCaps(hobbies.trim()) : null;
  const settlementText = settlement?.trim() ? sentenceCaseIfAllCaps(settlement.trim()) : null;

  const clickable = typeof onOpen === 'function';

  return (
    <article
      className={`profile-card${clickable ? ' profile-card--clickable' : ''}`}
      onClick={onOpen}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
    >
      <div className="profile-card-head">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h3 className="profile-card-name">{title}</h3>
          {isNew && (
            <span className="profile-tag profile-tag--new" title="Joined recently">
              New
            </span>
          )}
        </div>
        {subline ? (
          <p className="profile-card-subline">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
            {subline}
          </p>
        ) : null}
      </div>

      <ul className="profile-card-tags" aria-label="At a glance">
        <li className="profile-tag profile-tag--verified">
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
        </li>
        {tags.map((t) => (
          <li className="profile-tag" key={t}>
            {t}
          </li>
        ))}
      </ul>

      {educationText ? (
        <p className="profile-card-snippet">
          <span>Education:</span> {educationText}
        </p>
      ) : null}

      {hobbiesText ? (
        <p className="profile-card-snippet">
          <span>Interests:</span> {hobbiesText}
        </p>
      ) : null}

      {settlementText ? (
        <p className="profile-card-settlement">
          <span>Plans to settle:</span> {settlementText}
        </p>
      ) : null}

      {actions ? <div className="profile-card-actions">{actions}</div> : null}
      {note ? <p className="profile-card-note">{note}</p> : null}
    </article>
  );
}
