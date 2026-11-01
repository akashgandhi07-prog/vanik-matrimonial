import { Link } from 'react-router-dom';
import GuideCard from '../components/GuideCard';
import { PublicLayout } from '../components/Layout';
import RegisterBox from '../components/RegisterBox';
import { GUIDES, GUIDE_TOPICS } from '../content/content';

function guidesByTopic() {
  const known = GUIDE_TOPICS.map((topic) => ({ topic, guides: GUIDES.filter((g) => g.topic === topic) }));
  const other = GUIDES.filter((g) => !GUIDE_TOPICS.includes(g.topic));
  return [...known, { topic: 'More guides', guides: other }]
    .filter((s) => s.guides.length > 0)
    .map((s) => ({ ...s, id: `topic-${s.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }));
}

export default function GuidesIndex() {
  return (
    <PublicLayout>
      <header className="content-hero">
        <div className="layout-max content-hero-inner">
          <nav className="content-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
          </nav>
          <p className="landing-kicker">Advice from our volunteers</p>
          <h1 className="content-title">Guides for Gujarati Hindu and Jain singles and parents</h1>
          <p className="content-hero-lead">
            Friendly, practical advice on finding a life partner, from writing your profile and first meetings to
            talking about faith and family, written by the volunteers who run the Vanik Matrimonial Register.
          </p>
        </div>
      </header>

      <div className="layout-max guides-index">
        {guidesByTopic().map((section) => (
          <section key={section.topic} className="guides-index-section" aria-labelledby={section.id}>
            <h2 id={section.id} className="guides-index-topic">
              {section.topic}
            </h2>
            <ul className="guide-card-grid">
              {section.guides.map((g) => (
                <li key={g.path}>
                  <GuideCard guide={g} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <RegisterBox variant="end" audience="singles" />

        <p className="guides-index-more">
          Looking for quick answers? See the <Link to="/faq">frequently asked questions</Link>, or read our page{' '}
          <Link to="/for-parents">for parents</Link>.
        </p>
      </div>
    </PublicLayout>
  );
}
