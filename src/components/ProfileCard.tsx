import type { ReactNode } from 'react';

type Fact = { label: string; value: ReactNode };

export type ProfileCardProps = {
  age?: number | null;
  gender?: string | null;
  profession?: string | null;
  height?: string | null;
  diet?: string | null;
  location?: string | null;
  religion?: string | null;
  nationality?: string | null;
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
  onOpen,
  actions,
  note,
}: ProfileCardProps) {
  const facts: Fact[] = [];
  if (profession) facts.push({ label: 'Profession', value: profession });
  if (height) facts.push({ label: 'Height', value: height });
  if (diet) facts.push({ label: 'Diet', value: diet });
  if (location) facts.push({ label: 'Location', value: location });
  if (religion) facts.push({ label: 'Religion', value: religion });
  if (nationality) facts.push({ label: 'Nationality', value: nationality });

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
        <h3 className="profile-card-name">{age != null ? `Age ${age}` : 'Member'}</h3>
        <div className="profile-card-tags">
          {gender ? <span className="profile-tag">{gender}</span> : null}
          <span className="profile-tag profile-tag--verified">
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
      </div>

      {facts.length > 0 ? (
        <dl className="profile-card-facts">
          {facts.map((f) => (
            <div className="profile-card-fact" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {actions ? <div className="profile-card-actions">{actions}</div> : null}
      {note ? <p className="profile-card-note">{note}</p> : null}
    </article>
  );
}
