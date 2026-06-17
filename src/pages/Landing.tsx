import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { useSiteSession } from '../components/SessionContext';
import HeroArt from '../components/HeroArt';

export default function Landing() {
  const navigate = useNavigate();
  const { user, isAdmin, ready } = useSiteSession();

  useEffect(() => {
    if (!ready || !user) return;
    if (isAdmin) {
      navigate('/admin', { replace: true });
      return;
    }
    navigate('/dashboard/browse', { replace: true });
  }, [ready, user, isAdmin, navigate]);

  if (!ready || user) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading…
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="landing">
        {/* HERO */}
        <section className="landing-hero2 layout-max">
          <div className="landing-hero2-text">
            <p className="landing-kicker">Vanik Council</p>
            <h1 className="landing-title">Vanik Matrimonial Register</h1>
            <p className="landing-lead">
              A private introduction service for Hindu and Jain families, run by Vanik
              Council volunteers, helping families find respectful introductions for
              over 40 years.
            </p>
            <div className="landing-actions landing-actions--primary">
              <Link to="/register" className="btn btn-primary landing-cta-register">
                Register (£10/year)
              </Link>
              <Link to="/demo" className="btn btn-secondary landing-cta-demo">
                Demo browse profiles
              </Link>
            </div>
            <p className="landing-cta-note">
              Approved members get saved profiles, batched contact requests, and a full
              dashboard. Already a member?{' '}
              <Link to="/login" className="landing-cta-signin">Sign in</Link>.
            </p>
          </div>
          <div className="landing-hero2-art" aria-hidden="true">
            <HeroArt />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="landing-section layout-max">
          <header className="landing-section-head">
            <p className="landing-eyebrow">How it works</p>
            <h2>Three simple steps to your first introduction</h2>
          </header>
          <ol className="landing-steps">
            <li className="landing-step">
              <span className="landing-step-num">1</span>
              <h3>Register &amp; verify</h3>
              <p>
                Create your account and upload proof of identity. Our team reviews every
                application within 10 working days.
              </p>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">2</span>
              <h3>Browse &amp; save</h3>
              <p>
                Once approved, browse verified profiles and save anyone you&rsquo;d like
                to know more about.
              </p>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">3</span>
              <h3>Request contact</h3>
              <p>
                Ask for contact details and view them in your dashboard. Line up to three
                at a time; fair weekly and monthly limits keep things balanced.
              </p>
            </li>
          </ol>
        </section>

        {/* HIGHLIGHTS */}
        <section className="landing-section layout-max">
          <div className="landing-trust-grid" aria-label="Service highlights">
            <article className="landing-trust-card">
              <h2>Verified members</h2>
              <p>Each profile is reviewed by our team before it appears.</p>
            </article>
            <article className="landing-trust-card">
              <h2>Running for 40+ years</h2>
              <p>Many successful marriages through our community register.</p>
            </article>
            <article className="landing-trust-card">
              <h2>Community run</h2>
              <p>Not-for-profit service managed by Vanik Council volunteers.</p>
            </article>
          </div>
        </section>

        {/* REASSURANCE / CLOSING */}
        <section className="landing-closing layout-max">
          <div className="landing-closing-card">
            <p>
              Membership is open to adults 18 and over. Contact details are shared only
              inside your member dashboard when you ask for them. Nothing is ever
              displayed publicly. This is a not-for-profit service run by the community,
              for the community. We do not sell data or show advertising.
            </p>
            <p className="landing-closing-meta">
              <strong>Annual membership is £10</strong>, payable by card when you register.
              Questions before applying?{' '}
              <a href="mailto:matrimonial@vanikcouncil.uk">Email our team</a>.
            </p>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
