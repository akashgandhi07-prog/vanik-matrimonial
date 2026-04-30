export type RejectionGuide = {
  suggestions: string[];
  defaultStep: 1 | 2 | 3;
};

export function rejectionGuideFromReason(reason: string | null | undefined): RejectionGuide {
  const text = String(reason ?? '').toLowerCase();
  const has = (needle: string) => text.includes(needle);

  const photoIssue = has('photo') || has('blurry') || has('group');
  const idIssue = has('id') || has('identity') || has('passport') || has('driving licence');
  const detailsIssue =
    has('name') ||
    has('dob') ||
    has('date of birth') ||
    has('address') ||
    has('postcode') ||
    has('missing') ||
    has('incomplete');

  const suggestions: string[] = [
    'Open your application and correct the fields mentioned in the rejection reason.',
  ];

  if (photoIssue) {
    suggestions.push('Upload a clear solo face photo (no group photo, good lighting, JPG/PNG).');
  }
  if (idIssue) {
    suggestions.push('Upload a sharp, readable ID image with all edges visible (passport/driving licence).');
  }
  if (detailsIssue) {
    suggestions.push('Review key details (name, DOB, address, postcode) and correct any mismatch or missing values.');
  }
  if (!photoIssue && !idIssue && !detailsIssue) {
    suggestions.push('Review all required fields and uploads, then submit again.');
  }

  const defaultStep: 1 | 2 | 3 = photoIssue ? 3 : 1;
  return { suggestions, defaultStep };
}
