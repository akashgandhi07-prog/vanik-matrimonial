import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { GUIDES } from '../content/content';

export default function GuidesIndex() {
  return (
    <PublicLayout>
      <div className="layout-max content-page">
        <h1>Guides</h1>
        <p className="content-lead">
          Friendly, practical advice for Gujarati Hindu and Jain singles and their families, written by the
          volunteers who run the Vanik Matrimonial Register.
        </p>
        <ul className="content-guide-list">
          {GUIDES.map((g) => (
            <li key={g.path} className="card">
              <h2>
                <Link to={g.path}>{g.heading}</Link>
              </h2>
              <p>{g.description}</p>
            </li>
          ))}
        </ul>
        <p>
          Looking for quick answers? See the <Link to="/faq">frequently asked questions</Link>.
        </p>
      </div>
    </PublicLayout>
  );
}
