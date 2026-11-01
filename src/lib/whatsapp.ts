import { cmToFeetInches } from './heights';
import { sentenceCaseIfAllCaps, titleCaseIfAllCaps } from './displayCase';
import { dietLabel, religionLabel } from './profileLabels';

/**
 * Build a https://wa.me/... link for a stored phone number.
 * Handles common UK formats (leading 0) by normalising to country code 44.
 * Optionally pre-fills a starter message when `text` is supplied.
 */
export function whatsappUrlFromPhone(phone: string, text?: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  let n = digits;
  if (n.startsWith('0') && n.length >= 10 && n.length <= 12) {
    n = `44${n.slice(1)}`;
  }
  if (text && text.trim()) {
    return `https://wa.me/${n}?text=${encodeURIComponent(text.trim())}`;
  }
  return `https://wa.me/${n}`;
}

/**
 * Warm, polite starter message for a first WhatsApp message after an introduction.
 */
export function whatsappIntroText(
  recipientFirstName?: string | null,
  senderFirstName?: string | null
): string {
  const toName = recipientFirstName?.trim() ? titleCaseIfAllCaps(recipientFirstName.trim()) : '';
  const fromPart = senderFirstName?.trim()
    ? `This is ${titleCaseIfAllCaps(senderFirstName.trim())} - we`
    : 'We';
  return `Hi${toName ? ` ${toName}` : ''}, ${fromPart.charAt(0).toLowerCase() + fromPart.slice(1)} were introduced through the Vanik Matrimonial Register. Lovely to connect! How is your week going?`;
}

/**
 * Format a clean, respectful plain-text summary of an introduced profile so a
 * member can share it with parents or family on WhatsApp without raw URLs.
 */
export function familyShareSummaryText(profile: {
  first_name?: string | null;
  full_name?: string | null;
  age?: number | null;
  job_title?: string | null;
  education?: string | null;
  place_of_birth?: string | null;
  height_cm?: number | null;
  diet?: string | null;
  religion?: string | null;
  nationality?: string | null;
  town_country_of_origin?: string | null;
  future_settlement_plans?: string | null;
  hobbies?: string | null;
}): string {
  const name = profile.full_name?.trim()
    ? titleCaseIfAllCaps(profile.full_name.trim())
    : profile.first_name?.trim()
      ? titleCaseIfAllCaps(profile.first_name.trim())
      : 'Member';
  const heading = `${name}${profile.age != null ? `, ${profile.age}` : ''} (Vanik Matrimonial Register introduction)`;
  const lines: string[] = [heading];

  const basic = [
    profile.religion ? religionLabel(profile.religion) : null,
    profile.diet ? dietLabel(profile.diet) : null,
    profile.height_cm ? `${cmToFeetInches(profile.height_cm)} (${profile.height_cm} cm)` : null,
  ].filter(Boolean);
  if (basic.length > 0) lines.push(basic.join(' · '));

  if (profile.job_title?.trim()) {
    lines.push(`Profession: ${titleCaseIfAllCaps(profile.job_title.trim())}`);
  }
  if (profile.education?.trim()) {
    lines.push(`Education: ${titleCaseIfAllCaps(profile.education.trim())}`);
  }
  if (profile.place_of_birth?.trim()) {
    lines.push(`Location: ${titleCaseIfAllCaps(profile.place_of_birth.trim())}`);
  }
  if (profile.town_country_of_origin?.trim()) {
    lines.push(`Family origin: ${titleCaseIfAllCaps(profile.town_country_of_origin.trim())}`);
  }
  if (profile.nationality?.trim()) {
    lines.push(`Nationality: ${titleCaseIfAllCaps(profile.nationality.trim())}`);
  }
  if (profile.future_settlement_plans?.trim()) {
    lines.push(`Plans to settle: ${sentenceCaseIfAllCaps(profile.future_settlement_plans.trim())}`);
  }
  if (profile.hobbies?.trim()) {
    lines.push(`Hobbies & interests: ${sentenceCaseIfAllCaps(profile.hobbies.trim())}`);
  }

  return lines.join('\n');
}

/**
 * Build a https://wa.me/?text=... link that opens WhatsApp with a message ready to send.
 * Unlike whatsappUrlFromPhone, no recipient is set: the sender picks who to forward it to.
 */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
