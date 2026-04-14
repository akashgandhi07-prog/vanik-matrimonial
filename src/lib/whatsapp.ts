/**
 * Build a https://wa.me/... link for a stored phone number.
 * Handles common UK formats (leading 0) by normalising to country code 44.
 */
export function whatsappUrlFromPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  let n = digits;
  if (n.startsWith('0') && n.length >= 10 && n.length <= 12) {
    n = `44${n.slice(1)}`;
  }
  return `https://wa.me/${n}`;
}
