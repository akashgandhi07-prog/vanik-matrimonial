import { invokeFunction, supabase } from './supabase';

export type ProfileStatusLite = {
  status: string | null;
  reference_number: string | null;
  rejection_reason: string | null;
};

/** Where to send a signed-in member based on DB status (canonical routes). */
export function pathForMemberStatus(status: string | null): string | null {
  if (!status) return null;
  switch (status) {
    case 'pending_approval':
      return '/registration-pending';
    case 'rejected':
      return '/registration-rejected';
    case 'expired':
      return '/membership-expired';
    case 'active':
    case 'matched':
      return '/dashboard/browse';
    case 'archived':
      return '/membership-expired';
    default:
      return null;
  }
}

/** Client read with `member-bootstrap` fallback when RLS/timing returns no row. */
export async function fetchMyProfileStatusLite(userId: string): Promise<ProfileStatusLite | null> {
  const { data: p } = await supabase
    .from('profiles')
    .select('status, reference_number, rejection_reason')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (p != null) {
    const row = p as {
      status: string;
      reference_number: string | null;
      rejection_reason: string | null;
    };
    return {
      status: row.status ?? null,
      reference_number: row.reference_number ?? null,
      rejection_reason: row.rejection_reason ?? null,
    };
  }

  try {
    const boot = (await invokeFunction('member-bootstrap', {})) as {
      profile?: {
        status?: string;
        reference_number?: string | null;
        rejection_reason?: string | null;
      } | null;
    };
    const pr = boot.profile;
    if (!pr) return null;
    return {
      status: pr.status ?? null,
      reference_number: pr.reference_number ?? null,
      rejection_reason: pr.rejection_reason ?? null,
    };
  } catch {
    return null;
  }
}
