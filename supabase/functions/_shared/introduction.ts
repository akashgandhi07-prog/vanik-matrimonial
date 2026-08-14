import { stripHtml } from './sanitize.ts';
import { publicSiteBaseUrl } from './site-url.ts';

/**
 * Single source of truth for what an introduction shares between two members.
 *
 * Both the live flow (submit-contact-request, member-request-contacts,
 * dispatch-email) and the admin sharing preview (admin-sharing-preview) build
 * their payloads and email bodies through these functions, so the admin
 * "What gets shared" page can never drift from what members actually receive.
 * If you add or remove a shared field, change it here.
 */

export type ContactDetail = {
  profile_id: string;
  first_name: string;
  full_name: string;
  reference_number: string;
  mobile: string;
  email: string;
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The contact fields one member receives about the other once a request is made. */
export function buildContactDetail(
  profile: { id: string; first_name?: string | null; reference_number?: string | null } | undefined,
  priv: { surname?: string | null; mobile_phone?: string | null; email?: string | null } | undefined
): ContactDetail {
  const firstName = stripHtml(profile?.first_name ?? 'Member', 80);
  const surname = stripHtml(String(priv?.surname ?? ''), 80);
  return {
    profile_id: profile?.id ?? '',
    first_name: firstName,
    full_name: `${firstName}${surname ? ` ${surname}` : ''}`,
    reference_number: stripHtml(String(profile?.reference_number ?? ''), 20),
    mobile: stripHtml(String(priv?.mobile_phone ?? ''), 40),
    email: stripHtml(String(priv?.email ?? ''), 120),
  };
}

/** Candidate blocks inside the "contact details" email sent to the requester. */
export function buildCandidatesHtml(contacts: ContactDetail[]): string {
  return contacts
    .map(
      (c) =>
        `<div style="margin:14px 0;padding:12px 14px;border:1px solid #e8e1d6;border-radius:10px;">
          <p style="margin:0 0 6px;"><strong>${escapeHtml(c.full_name)}</strong></p>
          ${c.mobile ? `<p style="margin:0;"><strong>Mobile:</strong> ${escapeHtml(c.mobile)}</p>` : ''}
        </div>`
    )
    .join('');
}

export type EmailContent = { subject: string; inner: string };

/** Email to the requester listing the candidates' contact details. */
export function contactDetailsEmailContent(params: {
  requesterFirstName: string;
  requesterEmail: string;
  candidatesHtml: string;
}): EmailContent {
  const memberEmail = stripHtml(params.requesterEmail, 120);
  return {
    subject: 'Your requested candidate details',
    inner: `<p>Dear ${stripHtml(params.requesterFirstName, 60)},</p>
        <p>Please find below the contact details you requested. We ask that you use this information respectfully and in line with our community values.</p>
        ${params.candidatesHtml}
        <p style="margin-top:20px;">A copy of these details has been sent to <strong>${memberEmail}</strong>.</p>
        <p>We would be grateful for brief feedback in due course so we can keep the register helpful for everyone.</p>
        <p>Warm regards,<br/>The register team</p>`,
  };
}

/** Email to a candidate telling them who requested their details. */
export function introductionReceivedEmailContent(params: {
  recipientFirstName: string;
  requesterName: string;
  requesterAge: string;
}): EmailContent {
  const reqName = stripHtml(params.requesterName, 120);
  const reqAge = stripHtml(params.requesterAge, 8);
  return {
    subject: `${reqName} has requested your details - Vanik Matrimonial Register`,
    inner: `<p>Dear ${stripHtml(params.recipientFirstName, 60)},</p>
        <p><strong>${escapeHtml(reqName)}</strong>${reqAge ? `, age ${escapeHtml(reqAge)},` : ''} has requested your details through the register. They have received your contact details and may be in touch.</p>
        <p>Sign in to see their full profile, photos, and contact details under <strong>My requests &gt; Requested your details</strong>, so you can get in touch from your side too.</p>
        <p><a href="${publicSiteBaseUrl()}/login" style="display:inline-block;padding:10px 20px;background:#7b2e3b;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">View their full profile</a></p>
        <p>If you have any concerns about this introduction, contact us at <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>.</p>
        <p>With good wishes,<br/>The register team</p>`,
  };
}
