import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { letterHtml, sendResendEmail } from './resend.ts';
import { stripHtml } from './sanitize.ts';

export type EmailType =
  | 'account_archived'
  | 'registration_received'
  | 'registration_approved'
  | 'registration_rejected'
  | 'contact_details'
  | 'candidate_notification'
  | 'feedback_reminder_21'
  | 'feedback_reminder_35'
  | 'renewal_reminder'
  | 'membership_expired'
  | 'admin_daily_digest'
  | 'matched_congratulations'
  | 'photo_update_rejected'
  | 'admin_pending_reminder';

export type DispatchParams = {
  type: EmailType;
  recipientEmail?: string;
  recipientProfileId?: string | null;
  extraData?: Record<string, unknown>;
  /** Alias used by some callers */
  extra_data?: Record<string, unknown>;
};

function siteUrl(): string {
  return Deno.env.get('PUBLIC_SITE_URL') ?? 'https://vanikmatrimonial.co.uk';
}

async function logEmail(
  admin: SupabaseClient,
  row: {
    recipient_email: string | null;
    recipient_profile_id: string | null;
    email_type: string;
    subject: string;
    resend_message_id: string | null;
    status: string;
  }
) {
  await admin.from('email_log').insert(row);
}

export async function dispatchEmail(
  admin: SupabaseClient,
  resendKey: string,
  params: DispatchParams
): Promise<{ ok: boolean; error?: string; messageId?: string | null }> {
  const { type, recipientProfileId } = params;
  const extraData = params.extraData ?? params.extra_data ?? {};
  let to = params.recipientEmail ?? '';
  let subject = '';
  let inner = '';

  const fetchProfile = async (id: string) => {
    const { data: p } = await admin.from('profiles').select('*').eq('id', id).single();
    const { data: m } = await admin
      .from('member_private')
      .select('*')
      .eq('profile_id', id)
      .single();
    return { profile: p, member: m };
  };

  if (recipientProfileId && !to) {
    const { member } = await fetchProfile(recipientProfileId);
    to = member?.email ?? '';
  }

  if (!to) return { ok: false, error: 'No recipient' };

  switch (type) {
    case 'account_archived': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Your account has been archived';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>As requested, your profile has been archived and hidden from the register. Our team will retain minimal records for 30 days in line with our retention policy.</p>
        <p>If this was a mistake, please contact <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.</p>`;
      break;
    }
    case 'registration_received': {
      const first = stripHtml(String(extraData.first_name ?? ''), 80);
      const resubmitted = extraData.resubmitted === true;
      subject = resubmitted ? 'We have received your updated application' : 'Your registration has been received';
      inner = `<p>Dear ${first},</p>
        <p>${
          resubmitted
            ? 'Thank you — we have received your <strong>updated</strong> application and will review it again within five working days.'
            : 'We have received your application to the Vanik Matrimonial Register and will review it within five working days.'
        }</p>
        <p>If you have any questions, simply reply to this email.</p>`;
      break;
    }
    case 'registration_approved': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      const exp = profile.membership_expires_at
        ? new Date(profile.membership_expires_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '';
      subject = `Your account is now active — Vanik Matrimonial Register`;
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your account has now been created and your application has been approved. You can log in and start browsing profiles straight away.</p>
        ${exp ? `<p>Your membership is valid until <strong>${exp}</strong>.</p>` : ''}
        <p><a href="${siteUrl()}/login" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Log in now</a></p>
        <p><strong>How it works</strong></p>
        <ul>
          <li>Browse profiles of members — photos and names are only revealed once you have requested their details.</li>
          <li>You can request up to <strong>3</strong> profiles per 7-day window and up to <strong>6</strong> per calendar month.</li>
          <li>Once a request is submitted we will send you their contact details by email.</li>
          <li>We ask for a short piece of feedback after each introduction — this is for admin and safeguarding purposes only and is never shared with the other person.</li>
        </ul>
        <p>If you have any questions, simply reply to this email.</p>
        <p>With good wishes,<br/>The register team<br/><a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a></p>`;
      break;
    }
       case 'registration_rejected': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      const reason = stripHtml(String(extraData.reason ?? ''), 2000);
      const registerUrl = `${siteUrl()}/register`;
      subject = 'Regarding your Vanik Matrimonial Register application';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Unfortunately we are unable to approve your application at this time.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>You are welcome to sign in and <strong>update your application</strong> (for example a clearer profile photo or ID image) and submit again: <a href="${registerUrl}">${registerUrl}</a></p>
        <p>If you believe this is an error, please reply to this email.</p>`;
      break;
    }
    case 'contact_details': {
      const listHtml = String(extraData.candidates_html ?? '');
      const memberEmail = stripHtml(String(extraData.requester_email ?? ''), 120);
      subject = 'Your requested candidate details';
      inner = `<p>Dear ${stripHtml(String(extraData.requester_first_name ?? ''), 60)},</p>
        <p>Please find below the contact details you requested. We ask that you use this information respectfully and in line with our community values.</p>
        ${listHtml}
        <p style="margin-top:20px;">A copy of these details has been sent to <strong>${memberEmail}</strong>.</p>
        <p>We would be grateful for brief feedback in due course so we can keep the register helpful for everyone.</p>
        <p>Warm regards,<br/>The register team</p>`;
      break;
    }
    case 'candidate_notification': {
      const { profile } = await fetchProfile(recipientProfileId!);
      if (!profile) return { ok: false, error: 'Profile not found' };
      const reqGender = stripHtml(String(extraData.requester_gender ?? ''), 20);
      subject = 'Your profile was viewed';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your profile was recently viewed and your contact details have been shared with a <strong>${reqGender}</strong> member of the register.</p>
        <p>If you have any concerns, please contact us at <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a>.</p>`;
      break;
    }
    case 'feedback_reminder_21': {
      subject = 'Feedback reminder';
      inner = `<p>Dear ${stripHtml(String(extraData.first_name ?? ''),60)},</p>
        <p>It has been 21 days since you requested candidate details. We would be grateful for a few moments of your time to share brief feedback.</p>
        <p>${String(extraData.links_html ?? '')}</p>
        <p>Thank you for helping us maintain a trusted service.</p>`;
      break;
    }
    case 'feedback_reminder_35': {
      subject = 'Outstanding feedback: action required';
      inner = `<p>Dear ${stripHtml(String(extraData.first_name ?? ''), 60)},</p>
        <p>Outstanding feedback is now delaying further contact requests on your account. Please complete the short feedback forms as soon as you can.</p>
        <p>${String(extraData.links_html ?? '')}</p>
        <p>With thanks,<br/>The register team</p>`;
      break;
    }
    case 'renewal_reminder': {
      const n = Number(extraData.days ?? 30);
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      const exp = profile.membership_expires_at
        ? new Date(profile.membership_expires_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '';
      subject = `Your membership expires in ${n} days`;
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your membership expires on <strong>${exp}</strong>. The annual fee is £10.</p>
        <p>You can renew online here: <a href="${siteUrl()}/renew-membership">${siteUrl()}/renew-membership</a></p>
        <p>Alternatively, email us: <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a></p>`;
      break;
    }
    case 'membership_expired': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Your membership has expired';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your membership has now expired and your profile is hidden from the register.</p>
        <p>To renew online (£10/year): <a href="${siteUrl()}/renew-membership">${siteUrl()}/renew-membership</a></p>
        <p>Or email us: <a href="mailto:mahesh.gandhi@vanikcouncil.uk">mahesh.gandhi@vanikcouncil.uk</a></p>`;
      break;
    }
    case 'admin_daily_digest': {
      subject = 'Daily summary | Vanik Matrimonial Register';
      inner = `<p>Good morning,</p>
        <ul>
          <li>Pending approvals: <strong>${extraData.pending ?? 0}</strong></li>
          <li>Requests yesterday: <strong>${extraData.requests_yesterday ?? 0}</strong></li>
          <li>Expiring this month: <strong>${extraData.expiring ?? 0}</strong></li>
          <li>Flagged feedback: <strong>${extraData.flagged ?? 0}</strong></li>
        </ul>
        <p><a href="${siteUrl()}/admin">Open admin dashboard</a></p>`;
      break;
    }
    case 'matched_congratulations': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Congratulations from the Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>We were delighted to hear your news. Your profile has been removed from the register as requested.</p>
        <p>Thank you for using the Vanik Matrimonial Register, and our very best wishes for the future.</p>
        <p>Warm regards,<br/>Vanik Council</p>`;
      break;
    }
    case 'photo_update_rejected': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Profile photo not accepted';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>We were unable to accept the new profile photo you submitted. Your previous approved photo will continue to be shown.</p>
        <p>If you would like to try again with a different image, please sign in and upload a new photo from your profile.</p>
        <p><a href="${siteUrl()}/login">${siteUrl()}/login</a></p>
        <p>With thanks,<br/>The register team</p>`;
      break;
    }
    case 'admin_pending_reminder': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Reminder: your application is awaiting review';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>This is a friendly reminder that your application to the Vanik Matrimonial Register is still <strong>awaiting review</strong>.</p>
        <p>We aim to review applications within five working days. If you need to add information or upload clearer documents, please sign in: <a href="${siteUrl()}/login">${siteUrl()}/login</a></p>
        <p>If you have questions, reply to this email.</p>
        <p>With thanks,<br/>The register team</p>`;
      break;
    }
    default:
      return { ok: false, error: 'Unknown email type' };
  }

  const html = letterHtml('Vanik Matrimonial Register', inner);
  const { id, error } = await sendResendEmail(resendKey, { to, subject, html });
  const status = error ? 'failed' : 'sent';
  await logEmail(admin, {
    recipient_email: to,
    recipient_profile_id: recipientProfileId ?? null,
    email_type: type,
    subject,
    resend_message_id: id,
    status,
  });
  if (error) return { ok: false, error };
  return { ok: true, messageId: id };
}

/** Admin client factory */
export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}
