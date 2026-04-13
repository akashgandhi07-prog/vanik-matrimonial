import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function Landing() {
  return (
    <PublicLayout>
      <div className="layout-max">
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div>
            <p className="landing-kicker">Vanik Council</p>
            <h1 id="landing-heading" className="landing-title">
              A trusted register for Vanik and wider community families
            </h1>
            <p className="landing-lead">
              The Vanik Matrimonial Register is a private service for Hindu and Jain families in
              North London and beyond. Membership is verified, respectful, and handled with care.
            </p>
            <div className="landing-actions">
              <Link to="/register" className="btn btn-primary">
                Register
              </Link>
              <Link to="/login" className="btn btn-secondary">
                Member login
              </Link>
            </div>
            <ul className="landing-trust">
              <li>
                <span className="landing-trust-icon" aria-hidden="true">
                  ✓
                </span>
                Verified membership
              </li>
              <li>
                <span className="landing-trust-icon" aria-hidden="true">
                  ✓
                </span>
                Run by Vanik Council, not commercial
              </li>
              <li>
                <span className="landing-trust-icon" aria-hidden="true">
                  ✓
                </span>
                Respectful introductions
              </li>
            </ul>
          </div>
          <div className="landing-visual-wrap">
            <div className="landing-visual" role="img" aria-label="Decorative community motif">
              <div className="landing-visual-pattern" aria-hidden="true" />
              <div className="landing-visual-caption">
                <strong>Built for families</strong>
                <span>
                  A calm, dignified space for introductions within the community you know and trust.
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
