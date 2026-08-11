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
              Looking for a life partner who shares your values? Meet genuine, verified
              Gujarati Hindu and Jain singles through a private register trusted by our
              community for over 40 years - no endless swiping, no strangers, no
              time-wasters.
            </p>
            <div className="landing-actions landing-actions--primary">
              <Link to="/register" className="btn btn-primary landing-cta-register">
                Register (£10/year)
              </Link>
              <Link to="/demo" className="btn btn-secondary landing-cta-demo">
                Browse Profiles
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
                Create your profile and upload proof of identity. A real person checks
                every application, so you only ever meet genuine, verified members.
              </p>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">2</span>
              <h3>Browse &amp; save</h3>
              <p>
                Browse people who are looking for the same thing you are - marriage, not
                endless chatting - and save anyone who catches your eye.
              </p>
            </li>
            <li className="landing-step">
              <span className="landing-step-num">3</span>
              <h3>Request contact</h3>
              <p>
                When you&rsquo;re ready, request contact details and take it from there -
                a phone call, a coffee, a proper conversation. Up to three introductions
                at a time keeps it personal.
              </p>
            </li>
          </ol>
        </section>

        {/* HIGHLIGHTS */}
        <section className="landing-section layout-max">
          <div className="landing-trust-grid" aria-label="Service highlights">
            <article className="landing-trust-card">
              <h2>Real, verified people</h2>
              <p>
                Every profile is checked by our volunteers before it appears. No bots, no
                fake accounts.
              </p>
            </article>
            <article className="landing-trust-card">
              <h2>40+ years of marriages</h2>
              <p>
                Generations of couples in our community first met through this register.
              </p>
            </article>
            <article className="landing-trust-card">
              <h2>Community run, not-for-profit</h2>
              <p>
                Run by Vanik Council volunteers. £10 a year, no advertising, and your
                data is never sold.
              </p>
            </article>
          </div>
        </section>

        {/* FAQ */}
        <section className="landing-section layout-max" aria-labelledby="landing-faq-title">
          <header className="landing-section-head">
            <p className="landing-eyebrow">Common questions</p>
            <h2 id="landing-faq-title">Frequently asked questions</h2>
          </header>
          <div className="landing-faq">
            <details className="landing-faq-item">
              <summary>Who can join the Vanik Matrimonial Register?</summary>
              <p>
                Membership is open to adults aged 18 and over from Gujarati Hindu and
                Jain families. The register is run by Vanik Council volunteers in the UK
                and has helped families find respectful introductions for over 40 years.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>I&rsquo;m a parent - can I register on behalf of my son or daughter?</summary>
              <p>
                We love that parents want to help - many happy matches in our community
                started exactly that way. The account itself, though, should be created
                by the person looking to marry: they are the one who will browse
                profiles, receive introductions and speak with matches, and we verify
                each member&rsquo;s own identity. The best way to help is to share this
                page with them and encourage them to register - it only takes a few
                minutes, and you are very welcome to sit with them while they do.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>How much does membership cost?</summary>
              <p>
                Annual membership is £10, payable by card when you register. The register
                is a not-for-profit service run by the community, for the community -
                there is no advertising and data is never sold.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>How long does it take to be approved?</summary>
              <p>
                Every application is reviewed by the volunteer team, including proof of
                identity, within 10 working days. Once approved you can browse verified
                profiles and request introductions from your dashboard.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>Is my information kept private?</summary>
              <p>
                Yes. Contact details are shared only inside your member dashboard when
                you ask for them, and nothing is ever displayed publicly. Every profile
                is verified before it appears, and the service does not sell data or
                show advertising.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>How do introductions work?</summary>
              <p>
                Once approved, you browse verified profiles and save anyone you would
                like to know more about. You can then request contact details and view
                them in your dashboard - up to three at a time, with fair weekly and
                monthly limits to keep things balanced.
              </p>
            </details>
            <details className="landing-faq-item">
              <summary>Can I see profiles before registering?</summary>
              <p>
                Yes. You can <Link to="/demo">browse a preview of profiles</Link> before
                you decide to register. Full profiles, saved lists and contact requests
                are available to approved members.
              </p>
            </details>
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
