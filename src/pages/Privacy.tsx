import { PublicLayout } from '../components/Layout';

export default function Privacy() {
  return (
    <PublicLayout>
      <div className="layout-max card prose-safe" style={{ marginTop: 24 }}>
        <h1>Privacy policy</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Last updated: 13 April 2026. Data controller: <strong>Vanik Council</strong> (
          <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>).
        </p>
        <h2>What we collect</h2>
        <p>
          We collect the information you provide during registration and profile updates, including
          contact details, family background, preferences, profile photograph, and proof of identity
          for verification. We also log administrative actions and transactional emails sent
          through our systems.
        </p>
        <h2>How we use your data</h2>
        <p>
          Data is used solely to operate the matrimonial register: verifying members, displaying
          appropriate profile information to other approved members, facilitating contact requests,
          and meeting our safeguarding obligations. We do not sell personal data or use it for
          unrelated marketing.
        </p>
        <h2>Identity documents</h2>
        <p>
          Passport or driving licence uploads are used only to verify your identity. Once your
          application is approved, these files are deleted from our storage and the reference in our
          database is cleared.
        </p>
        <h2>Your rights (UK GDPR)</h2>
        <p>
          You may request access, correction, or deletion of your personal data. To exercise these
          rights, email{' '}
          <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>. We
          respond within statutory timeframes. You may also lodge a complaint with the Information
          Commissioner’s Office (ICO).
        </p>
        <h2>Retention</h2>
        <p>
          We retain records only as long as needed for the register, legal obligations, and
          safeguarding. Archived or deleted accounts may be held for a limited period before secure
          disposal.
        </p>
      </div>
    </PublicLayout>
  );
}
