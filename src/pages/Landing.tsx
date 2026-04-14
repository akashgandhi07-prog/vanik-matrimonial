import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function Landing() {
  return (
    <PublicLayout>
      <div className="layout-max">
        <div className="landing-wrap">
          <div className="landing-body">
            <p className="landing-kicker">Vanik Council</p>

            <h1 className="landing-title">
              Vanik Matrimonial Register
            </h1>

            <p className="landing-lead">
              A private introduction service for Vanik and wider Hindu and Jain families,
              run by Vanik Council volunteers. We have been helping families find
              respectful introductions for many years.
            </p>

            <p className="landing-lead">
              Membership is open to adults 18 and over. Every application is reviewed
              by our team before a profile goes live. Contact details are shared only
              by email, and only when you ask us to. Nothing is displayed publicly.
            </p>

            <div className="landing-actions">
              <Link to="/register" className="btn btn-primary">
                Apply to join
              </Link>
              <Link to="/login" className="btn btn-secondary">
                Member login
              </Link>
            </div>

            <div className="landing-details">
              <p>
                <strong>Annual membership</strong> is £10, payable by card when you
                register. Coupons are available; ask the Vanik Council if you have
                one.
              </p>
              <p>
                If you have any questions before applying, please{' '}
                <a href="mailto:register@vanikmatrimonial.co.uk">
                  email our team
                </a>
                .
              </p>
            </div>
          </div>

          <aside className="landing-aside">
            <div className="landing-aside-card">
              <h2>How it works</h2>
              <ol className="landing-steps-list">
                <li>Register and upload proof of identity. We review your application within five working days.</li>
                <li>Once approved, browse verified profiles and save anyone you'd like to know more about.</li>
                <li>Request contact details from us. We share them by email to both families.</li>
              </ol>
            </div>

            <div className="landing-aside-card landing-aside-card--muted">
              <p>
                This is a not-for-profit service run by the community, for the community.
                We do not sell data or show advertising.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </PublicLayout>
  );
}
