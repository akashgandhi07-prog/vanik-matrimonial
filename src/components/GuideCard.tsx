import { Link } from 'react-router-dom';
import type { ContentEntry } from '../content/content';

export default function GuideCard({ guide, headingLevel = 3 }: { guide: ContentEntry; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="guide-card">
      {guide.topic && <p className="guide-card-topic">{guide.topic}</p>}
      <H className="guide-card-title">
        <Link to={guide.path}>{guide.heading}</Link>
      </H>
      <p className="guide-card-desc">{guide.description}</p>
      <p className="guide-card-meta">{guide.readingMinutes} min read</p>
    </article>
  );
}
