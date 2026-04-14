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
  | 'photo_update_rejected';

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
      subject = 'Your account has been archived — Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>As requested, your profile has been archived and hidden from the register. Our team will retain minimal records for 30 days in line with our retention policy.</p>
        <p>If this was a mistake, please contact <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.</p>`;
      break;
    }
    case 'registration_received': {
      const first = stripHtml(String(extraData.first_name ?? ''), 80);
      const ref = stripHtml(String(extraData.reference_number ?? ''), 20);
      subject = 'Your registration has been received';
      inner = `<p>Dear ${first},</p>
        <p>We have received your application to the Vanik Matrimonial Register and will review it within five working days.</p>
        <p>Your reference: <strong>${ref}</strong></p>
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
      subject = `Welcome to the Vanik Matrimonial Register, ${stripHtml(profile.first_name, 60)}`;
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your application has been approved. Your reference number is <strong>${stripHtml(profile.reference_number ?? '', 20)}</strong>.</p>
        <p>Your membership is valid until <strong>${exp}</strong>.</p>
        <p>You can sign in here: <a href="${siteUrl()}/login">${siteUrl()}/login</a></p>
        <p><strong>How it works</strong></p>
        <ul>
          <li>Browse profiles of members of the opposite gender.</li>
          <li>Save favourites and request contact details (up to weekly limits).</li>
          <li>We will email you candidate details securely when requests are approved.</li>
        </ul>
        <p>With good wishes,<br/>The register team<br/><a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a></p>`;
      break;
    }
    case 'registration_rejected': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      const reason = stripHtml(String(extraData.reason ?? ''), 2000);
      subject = 'Regarding your Vanik Matrimonial Register application';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Unfortunately we are unable to approve your application at this time.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>If you believe this is an error, please reply to this email.</p>`;
      break;
    }
    case 'contact_details': {
      const listHtml = String(extraData.candidates_html ?? '');
      const memberEmail = stripHtml(String(extraData.requester_email ?? ''), 120);
      subject = 'Your requested candidate details — Vanik Matrimonial Register';
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
      subject = 'Your profile was viewed — Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your profile was recently viewed and your contact details have been shared with a <strong>${reqGender}</strong> member of the register.</p>
        <p>If you have any concerns, please contact us at <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.</p>`;
      break;
    }
    case 'feedback_reminder_21': {
      subject = 'Feedback reminder — Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(String(extraData.first_name ?? ''),60)},</p>
        <p>It has been 21 days since you requested candidate details. We would be grateful for a few moments of your time to share brief feedback.</p>
        <p>${String(extraData.links_html ?? '')}</p>
        <p>Thank you for helping us maintain a trusted service.</p>`;
      break;
    }
    case 'feedback_reminder_35': {
      subject = 'Outstanding feedback — action required';
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
      subject = `Your membership expires in ${n} days — Vanik Matrimonial Register`;
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your membership expires on <strong>${exp}</strong>. The annual fee is £10.</p>
        <p>You can renew online here: <a href="${siteUrl()}/renew-membership">${siteUrl()}/renew-membership</a></p>
        <p>Alternatively, email us: <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a></p>`;
      break;
    }
    case 'membership_expired': {
      const { profile, member } = await fetchProfile(recipientProfileId!);
      if (!profile || !member) return { ok: false, error: 'Profile not found' };
      subject = 'Your membership has expired — Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>Your membership has now expired and your profile is hidden from the register.</p>
        <p>To renew online (£10/year): <a href="${siteUrl()}/renew-membership">${siteUrl()}/renew-membership</a></p>
        <p>Or email us: <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a></p>`;
      break;
    }
    case 'admin_daily_digest': {
      subject = 'Daily summary — Vanik Matrimonial Register';
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
      subject = 'Profile photo not accepted — Vanik Matrimonial Register';
      inner = `<p>Dear ${stripHtml(profile.first_name, 60)},</p>
        <p>We were unable to accept the new profile photo you submitted. Your previous approved photo will continue to be shown.</p>
        <p>If you would like to try again with a different image, please sign in and upload a new photo from your profile.</p>
        <p><a href="${siteUrl()}/login">${siteUrl()}/login</a></p>
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
