import { PublicLayout } from '../components/Layout';
import { PRIVACY_POLICY_LAST_UPDATED_DISPLAY, PRIVACY_POLICY_VERSION_ID } from '../lib/privacyPolicyVersion';

export default function Privacy() {
  return (
    <PublicLayout>
      <div className="layout-max card prose-safe" style={{ marginTop: 24 }}>
        <h1>Privacy policy</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Last updated: {PRIVACY_POLICY_LAST_UPDATED_DISPLAY}. Policy version:{' '}
          <strong>{PRIVACY_POLICY_VERSION_ID}</strong>. Data controller: <strong>Vanik Council</strong> (
          <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>
          ).
        </p>

        <h2 id="terms">Terms of use</h2>
        <p>
          By registering for the Vanik Matrimonial Register you agree to use the service respectfully, to provide
          accurate information, and to follow any instructions given by the register team. Misuse of contact details,
          harassment, or misrepresentation may result in suspension or removal from the register.
        </p>

        <h2>What we collect</h2>
        <p>We collect the information you provide during registration and profile updates, including:</p>
        <ul>
          <li>
            Identity and account: name, gender, age derived from date of birth, nationality, origins, email, and mobile.
          </li>
          <li>
            Household and parental names, address fields you choose to supply, and eligibility and preference fields
            displayed on profiles.
          </li>
          <li>Photos for your profile.</li>
          <li>Temporary uploads of passport or driving licence images for verification.</li>
          <li>Billing artefacts when you pay by card (processed by our payment provider; see below).</li>
        </ul>
        <p>
          We generate reference numbers for approved members and keep operational logs including administrative actions,
          contact-request activity, transactional email logs, safeguards-related notes where applicable, coupon use, optional
          app feedback you send while signed in, and rate-limiting metadata for abusive registration attempts (see local
          storage below).
        </p>

        <h2>Special category personal data</h2>
        <p>
          Under UK GDPR, certain information is treated more strictly as <strong>special category</strong> personal data.
          For this service, <strong>religious belief</strong> falls into this category because you may declare religion on
          your profile as part of community matching within the matrimonial register.
        </p>
        <p>
          <strong>Diet</strong> and <strong>community</strong> fields are primarily used to describe lifestyle and
          background for matching. Depending on how they are used, they could reveal religious or ethnic origin in some
          contexts; we treat them with the same care as other sensitive profile content and only use them for the register
          purposes described below.
        </p>
        <p>
          We process special category data where you have given <strong>explicit consent</strong> at registration (by ticking
          the declaration that you have read this notice and agreeing to membership terms), and/or where processing is
          necessary for substantial public interest safeguarding reasons that apply to a community matrimonial scheme. Our
          written record of purposes and conditions is summarised internally in our Records of Processing (see organisational
          documentation provided to trustees or DPO).
        </p>

        <h2>Why we process your data and lawful bases</h2>
        <p>We rely on UK GDPR lawful bases appropriate to each activity:</p>
        <ul>
          <li>
            <strong>Performance of our contract</strong> with you as an applicant or member running your profile,
            membership, eligibility checks, renewal, and facilitating introductions between opposite-gender members you choose
            to contact.
          </li>
          <li>
            <strong>Consent</strong> where we ask for consent for contact sharing declarations, declarations that you meet
            the adult age threshold, explicit acceptance of this policy and terms, and (where applicable) optional
            processing such as certain feedback you send.
          </li>
          <li>
            <strong>Legal obligation</strong> where we must retain or disclose information to regulators, law enforcement, or
            courts.
          </li>
          <li>
            <strong>Legitimate interests</strong> of Vanik Council and members in operating a safe register: logging
            administrative actions, abuse prevention (rate limits), quality of service, and defending legal claims, where not
            overridden by your rights.
          </li>
          <li>
            <strong>Substantial public interest / safeguarding</strong> (Data Protection Act 2018 Schedule 1) for protecting
            members in a community-led matrimonial context, including reviewing applications and handling serious concerns.
          </li>
        </ul>

        <h2>Recipients and subprocessors</h2>
        <p>We use trusted service providers who process personal data on our instructions (Article 28 processors):</p>
        <ul>
          <li>
            <strong>Supabase</strong>: authentication, database, file storage, and Edge Functions that power the register.
            Their documentation lists sub-processors; we configure project region and security settings in the Supabase
            dashboard.
          </li>
          <li>
            <strong>Stripe</strong>: card payments for registration and renewals. Stripe receives payment and limited account
            metadata needed to complete checkout.
          </li>
          <li>
            <strong>Email delivery</strong>: transactional email via SMTP you configure and/or Resend when enabled. Message
            content may include your name, reference, and operational links.
          </li>
          <li>
            <strong>Website hosting</strong>: the organisation that serves the public website (for example a static host in
            front of our application) may process IP addresses and standard HTTP logs.
          </li>
        </ul>
        <p>
          Council staff and designated administrators with role-based access can view member records to verify
          applications, operate the register, and meet safeguarding duties. We do not sell personal data.
        </p>

        <h2>International transfers</h2>
        <p>
          Some processors may store or process data outside the United Kingdom. Where that happens, we use appropriate
          safeguards recognised under UK law (for example processor standard contractual clauses and the UK addendum where
          required) together with supplementary measures where applicable. Copies of relevant transfer summaries are retained
          with our processor agreements.
        </p>

        <h2 id="retention">Retention</h2>
        <p>We keep data only as long as reasonably necessary:</p>
        <ul>
          <li>
            <strong>ID documents</strong>: deleted from storage shortly after approval, or promptly on rejection, with a note
            of deletion time retained in the membership record until you are otherwise erased.
          </li>
          <li>
            <strong>Rejected applications</strong>: profile and eligibility information are handled according to our internal
            practice for appeals and safeguarding; identifiers may be withheld from the browsing register automatically.
          </li>
          <li>
            <strong>Active and lapsed memberships</strong>: retained to evidence membership, renewals, and conduct of the
            register; archived or matched states may be kept longer where rules of the council require continuity.
          </li>
          <li>
            <strong>Operational logs</strong> (<em>email_log</em>, <em>admin_actions</em>, contact-request history where it is
            stored): kept for safeguarding, auditing disputes, and service integrity, typically for a bounded period aligned
            to council governance unless law requires otherwise.
          </li>
          <li>
            <strong>Billing reconciliation</strong>: Stripe-related records retained as needed for accounting, tax, and
            disputes.
          </li>
          <li>
            <strong>Consent evidence</strong>: flags, policy version, and timestamp captured at submission (and optionally a
            one-way hash relating to submission network context when enabled) retained with your membership record to
            demonstrate compliance.
          </li>
        </ul>
        <p>Exact periods are also maintained in our Records of Processing and reviewed annually.</p>

        <h2 id="browser-storage">Cookies and local storage on your device</h2>
        <p>
          Sign-in uses standard session cookies or equivalent storage from our authentication provider (Supabase) to keep
          you logged in securely.
        </p>
        <p>
          The registration form may save a <strong>draft</strong> of your answers in your browser&apos;s{' '}
          <strong>localStorage</strong> so you can continue later. That draft can include personal data until you submit or
          clear your browser data. It is not uploaded until you complete each step and submit. Use a private device and clear
          storage if you share the computer.
        </p>

        <h2>Security</h2>
        <p>
          We use access controls, encryption in transit, row-level security in the database, segregated storage buckets, and
          administrative auditing. No system is perfectly secure; if we become aware of a breach that risks your rights, we
          will follow our incident response plan and notify you and the ICO where required.
        </p>

        <h2>Your rights (UK GDPR)</h2>
        <p>You may contact us to:</p>
        <ul>
          <li>Request access to your personal data,</li>
          <li>Ask us to correct inaccurate data,</li>
          <li>Request erasure where applicable,</li>
          <li>Request restriction of processing in certain cases,</li>
          <li>Object to processing based on legitimate interests where the law allows,</li>
          <li>Request portability for data you supplied that we process by automated means under contract or consent.</li>
        </ul>
        <p>
          Email{' '}
          <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a> to exercise your rights. We respond
          within statutory timeframes and may ask for reasonable identity checks. You may complain to the Information
          Commissioner&apos;s Office: <a href="https://ico.org.uk/">https://ico.org.uk/</a>.
        </p>

        <h2>Changes to this notice</h2>
        <p>
          When we materially change this policy we will update the “last updated” date and policy version identifier. For new
          registrations we record the version you accepted. Where a change requires fresh consent, we will ask for it before
          continuing optional processing.
        </p>
      </div>
    </PublicLayout>
  );
}
