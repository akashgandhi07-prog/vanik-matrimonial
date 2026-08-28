/**
 * The end-to-end introduction process, in one place.
 *
 * Members previously had to infer the process from scattered rules: a tip that
 * stopped at "add to tray", two limit counters, and a feedback warning that only
 * appeared once they were already blocked. Nothing said what submitting actually
 * does - that there is no approval or acceptance step and that details cross both
 * ways immediately. Feedback asked for the process to be spelled out, so this is
 * the single source of that explanation; both Browse and My requests render it.
 */

type Props = {
  weeklyCap: number;
  monthlyCap: number;
  /**
   * How many people may go in one submission. Callers pass a server-aligned
   * number (see `maxCandidatesPerSubmit`) rather than a literal, so members on
   * an admin-raised allowance are not told the base figure.
   */
  batchSize: number;
  /** Open on first read (a member with no introductions yet), collapsed after. */
  defaultOpen?: boolean;
  /** My requests states the limits itself, with page-specific detail; don't repeat them. */
  showLimits?: boolean;
};

export function IntroductionSteps({
  weeklyCap,
  monthlyCap,
  batchSize,
  defaultOpen = false,
  showLimits = true,
}: Props) {
  return (
    <details className="intro-steps" open={defaultOpen}>
      <summary className="intro-steps-summary">How an introduction works</summary>
      <ol className="intro-steps-list">
        <li>
          <strong>Browse anonymously.</strong> Cards show age, height, education and background, but no names or
          photos. Nobody is told that you looked at their profile.
        </li>
        <li>
          <strong>Add up to {batchSize} {batchSize === 1 ? 'person' : 'people'} to your tray.</strong> Nothing is sent
          while they sit there, and you can remove anyone before you submit.
        </li>
        <li>
          <strong>Submit the batch.</strong> There is no approval step and nobody has to accept. The introduction is
          made straight away.
        </li>
        <li>
          <strong>You both receive each other&apos;s details.</strong> Their name and mobile number are emailed to you
          and listed under My requests. They get an email saying you asked, and your full profile, photos and contact
          details appear in their My requests.
        </li>
        <li>
          <strong>Get in touch directly.</strong> The register does not pass messages on. Either side can make the
          first move, so they may well contact you first.
        </li>
        <li>
          <strong>Tell us how it went within 21 days.</strong> Feedback goes only to the volunteer team and is never
          shown to the other member. Introductions older than 21 days without it pause new requests until you catch
          up.
        </li>
      </ol>
      {showLimits && (
        <p className="intro-steps-limits">
          <strong>Limits:</strong> {weeklyCap} new {weeklyCap === 1 ? 'person' : 'people'} per rolling 7 days and{' '}
          {monthlyCap} per calendar month. You cannot request the same person again within 7 days.
        </p>
      )}
    </details>
  );
}
