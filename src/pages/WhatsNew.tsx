import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';

type Entry = {
  /** e.g. "August 2026" */
  period: string;
  /** Optional strapline under the period heading. */
  note?: string;
  items: { text: React.ReactNode; fromFeedback?: boolean }[];
};

/**
 * Public, curated changelog. Plain member-facing sentences only - no internal
 * or technical detail. House style: no em or en dashes anywhere.
 */
const ENTRIES: Entry[] = [
  {
    period: 'August 2026',
    note: 'Several of these came straight from member feedback. Keep it coming!',
    items: [
      {
        fromFeedback: true,
        text: (
          <>
            <strong>Requests are now two-way introductions.</strong> When someone requests your details, you
            receive theirs too: their full profile, photos and contact details appear under{' '}
            <strong>My requests &gt; Requested your details</strong>, and you get an email so you know who to
            expect to hear from.
          </>
        ),
      },
      {
        text: (
          <>
            <strong>Browse knows who you have met.</strong> Profiles that already requested you are clearly
            marked, and a new filter lets you show or hide people whose details you already have.
          </>
        ),
      },
      {
        text: (
          <>
            <strong>See your visibility at a glance.</strong> Your dashboard now always shows whether your
            profile is live on the register, paused, or hidden.
          </>
        ),
      },
      {
        text: (
          <>
            <strong>Pausing now asks why.</strong> If you pause your profile we ask the reason - especially
            whether you found someone through the register. It helps the volunteer team know what is working.
          </>
        ),
      },
      {
        text: (
          <>
            <strong>Better emails.</strong> A fresh design and a more reliable delivery service, so important
            messages reach you promptly.
          </>
        ),
      },
      {
        text: (
          <>
            <strong>Clearer photo guidance.</strong> Better tips on choosing a main photo where your face is
            easy to see.
          </>
        ),
      },
    ],
  },
  {
    period: 'July 2026',
    items: [
      {
        text: (
          <>
            <strong>Recommend a friend.</strong> Share your personal code from the dashboard: you get 2 free
            months for every friend who is accepted, and they get 1 bonus month.
          </>
        ),
      },
    ],
  },
];

export default function WhatsNew() {
  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 720, marginTop: 40, marginBottom: 40 }}>
        <h1 style={{ marginBottom: 4 }}>What&apos;s new</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginTop: 0 }}>
          Improvements to the register, in plain English. Have an idea? Tell us via{' '}
          <Link to="/app-feedback">Feedback</Link> - many of the changes below started as a member suggestion.
        </p>
        {ENTRIES.map((e) => (
          <section key={e.period} className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>{e.period}</h2>
            {e.note && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: -6 }}>{e.note}</p>
            )}
            <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 10 }}>
              {e.items.map((item, i) => (
                <li key={i} style={{ fontSize: 15, lineHeight: 1.55 }}>
                  {item.fromFeedback && (
                    <span
                      className="badge"
                      style={{
                        marginRight: 8,
                        background: 'var(--color-accent-soft)',
                        color: 'var(--color-accent-hover)',
                        border: '1px solid var(--color-accent)',
                        fontSize: 11,
                        fontWeight: 700,
                        verticalAlign: 'middle',
                      }}
                    >
                      You asked, we built it
                    </span>
                  )}
                  {item.text}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicLayout>
  );
}
