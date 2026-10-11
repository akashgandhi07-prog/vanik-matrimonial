import { invokePublicFunction } from './supabase';
import { whatsappShareUrl } from './whatsapp';

export type ReferralEvent = 'open' | 'share';

/** The invite link a member sends. The /register page captures ?ref= and prefills the code. */
export function referralInviteLink(code: string): string {
  return `${window.location.origin}/register?ref=${encodeURIComponent(code)}`;
}

/** The message a member sends, shared by the banner and the Referrals tab. */
export function referralInviteMessage(code: string): string {
  return `Join me on the Vanik Matrimonial Register - use my code ${code} when you register and we both get free months: ${referralInviteLink(code)}`;
}

/** One-tap WhatsApp share link for the invite message. */
export function referralWhatsappUrl(code: string): string {
  return whatsappShareUrl(referralInviteMessage(code));
}

/**
 * Count a funnel step. Analytics only: never throws and never blocks the user,
 * so a failed call is simply lost. Opens are de-duplicated per browser session so
 * a refresh does not inflate the count.
 */
export function recordReferralEvent(code: string, event: ReferralEvent): void {
  if (event === 'open') {
    try {
      const key = `vmr_ref_open_${code.toUpperCase()}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* sessionStorage unavailable: count the open anyway */
    }
  }
  void invokePublicFunction('record-referral-event', { code, event }).catch(() => {
    /* analytics only */
  });
}
