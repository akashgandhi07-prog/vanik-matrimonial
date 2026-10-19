// Display labels for stored profile values. Stored values stay short ("Veg",
// "Jain") so filters keep working; these read better on cards and profiles,
// where a bare "Jain" diet tag would be confused with religion.

const DIET_LABELS: Record<string, string> = {
  Veg: 'Vegetarian',
  'Non-veg': 'Non-vegetarian',
  Jain: 'Jain diet',
};

export function dietLabel(diet: string | null | undefined): string | null {
  if (!diet) return null;
  return DIET_LABELS[diet] ?? diet;
}

export function religionLabel(religion: string | null | undefined): string | null {
  if (!religion) return null;
  return religion === 'Other' ? 'Other religion' : religion;
}

/** `tel:` link for a stored phone number (keeps digits and a leading +). */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : `tel:${encodeURIComponent(phone)}`;
}
