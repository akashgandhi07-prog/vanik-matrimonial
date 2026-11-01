import { Link, useLocation } from 'react-router-dom';

type Props = {
  /** `inline` sits mid-article, `end` closes the page, `aside` is the sticky sidebar card. */
  variant: 'inline' | 'end' | 'aside';
  /** Parents can't register for their child, so they get a "share it with them" version. */
  audience: 'singles' | 'parents';
};

const POINTS = [
  'Every member ID-checked by a Vanik Council volunteer',
  'Up to three introductions at a time, no endless chatting',
  '£10 a year, not-for-profit, no adverts',
];

const COPY = {
  singles: {
    inline: {
      title: 'Looking for someone who shares your values?',
      text: 'The Vanik Matrimonial Register has introduced Gujarati Hindu and Jain families for over 40 years. Every member is verified, and your details are never shown publicly.',
    },
    end: {
      title: 'Ready to meet someone who shares your values?',
      text: 'Join the not-for-profit register run by Vanik Council volunteers. Applications are checked within 2 working days.',
    },
    aside: { title: 'Meet verified Gujarati Hindu and Jain singles', text: '' },
  },
  parents: {
    inline: {
      title: 'Helping your son or daughter?',
      text: 'The person looking to marry creates their own account, but you can look through a preview of profiles together and share the registration link with them.',
    },
    end: {
      title: 'Share the register with your son or daughter',
      text: 'Run by Vanik Council volunteers for over 40 years. Every member is verified, and nothing is shown publicly.',
    },
    aside: { title: 'A trusted register for Gujarati Hindu and Jain families', text: '' },
  },
} as const;

export default function RegisterBox({ variant, audience }: Props) {
  const copy = COPY[audience][variant];
  const { pathname } = useLocation();
  const forParents = audience === 'parents';
  const primary = forParents ? (
    <Link to="/demo" className="btn btn-primary">
      Preview profiles together
    </Link>
  ) : (
    <Link to="/register" className="btn btn-primary">
      Register now (£10/year)
    </Link>
  );
  const secondary = forParents ? (
    <Link to={pathname === '/for-parents' ? '/guides/parents-guide' : '/for-parents'} className="btn btn-secondary">
      {pathname === '/for-parents' ? 'Read the parents\' guide' : 'How parents can help'}
    </Link>
  ) : (
    <Link to="/demo" className="btn btn-secondary">
      Browse profiles first
    </Link>
  );

  if (variant === 'aside') {
    return (
      <div className="register-box register-box--aside">
        <p className="register-box-kicker">Vanik Matrimonial Register</p>
        <p className="register-box-title">{copy.title}</p>
        <ul className="register-box-points">
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="register-box-actions">
          {primary}
          {secondary}
        </div>
      </div>
    );
  }

  return (
    <aside className={`register-box register-box--${variant}`} aria-label="Join the Vanik Matrimonial Register">
      <div className="register-box-text">
        <p className="register-box-title">{copy.title}</p>
        <p>{copy.text}</p>
        {variant === 'end' && (
          <ul className="register-box-points">
            {POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="register-box-actions">
        {primary}
        {secondary}
      </div>
    </aside>
  );
}
