import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

export default function NotFound() {
  return (
    <PublicLayout>
      <div className="layout-max content-page">
        <h1>Page not found</h1>
        <p className="content-lead">Sorry, we couldn&rsquo;t find that page. It may have moved.</p>
        <ul>
          <li>
            <Link to="/">Go to the homepage</Link>
          </li>
          <li>
            <Link to="/faq">Read the frequently asked questions</Link>
          </li>
          <li>
            <Link to="/guides">Browse our guides</Link>
          </li>
          <li>
            <Link to="/login">Sign in to your account</Link>
          </li>
        </ul>
      </div>
    </PublicLayout>
  );
}
