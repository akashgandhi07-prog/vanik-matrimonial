import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export type MemberStoragePaths = { photos: string[]; idDocuments: string[] };

/**
 * Every storage object that belongs to each profile: gallery photos, the
 * primary/pending photo columns and ID documents, keyed by profile id. Collect
 * these BEFORE deleting the auth user - the cascade removes the rows that point
 * at the files, after which the objects can never be found again.
 */
export async function collectMemberStoragePaths(
  admin: SupabaseClient,
  profileIds: string[]
): Promise<{ byProfile: Map<string, MemberStoragePaths>; error?: string }> {
  const byProfile = new Map<string, MemberStoragePaths>();
  if (profileIds.length === 0) return { byProfile };
  const [galleryRes, profRes, privRes] = await Promise.all([
    admin.from('profile_photos').select('profile_id, storage_path').in('profile_id', profileIds),
    admin.from('profiles').select('id, auth_user_id, gender, photo_url, pending_photo_url').in('id', profileIds),
    admin.from('member_private').select('profile_id, id_document_url').in('profile_id', profileIds),
  ]);
  const err = galleryRes.error ?? profRes.error ?? privRes.error;
  if (err) return { byProfile, error: err.message };

  const ownerByProfile = new Map<string, { authUserId: string; gender: string }>();
  for (const row of profRes.data ?? []) {
    const r = row as { id: string; auth_user_id?: string | null; gender?: string | null };
    if (r.id && r.auth_user_id) {
      ownerByProfile.set(r.id, {
        authUserId: r.auth_user_id,
        gender: r.gender === 'Female' ? 'Female' : 'Male',
      });
    }
  }

  const ownsPhotoPath = (profileId: string, p: string): boolean => {
    const owner = ownerByProfile.get(profileId);
    if (!owner || !p || p.includes('..') || p.includes('\\')) return false;
    return (
      p.startsWith(`${owner.gender}/${owner.authUserId}/`) ||
      p.startsWith(`Male/${owner.authUserId}/`) ||
      p.startsWith(`Female/${owner.authUserId}/`) ||
      p.startsWith(`${owner.authUserId}/`)
    );
  };

  const ownsIdDocPath = (profileId: string, p: string): boolean => {
    const owner = ownerByProfile.get(profileId);
    if (!owner || !p || p.includes('..') || p.includes('\\')) return false;
    return p.startsWith(`${owner.authUserId}/`);
  };

  const sets = new Map<string, { photos: Set<string>; idDocuments: Set<string> }>();
  const entry = (pid: string) => {
    let e = sets.get(pid);
    if (!e) sets.set(pid, (e = { photos: new Set(), idDocuments: new Set() }));
    return e;
  };
  for (const row of galleryRes.data ?? []) {
    const r = row as { profile_id: string; storage_path?: string | null };
    if (r.storage_path && ownsPhotoPath(r.profile_id, r.storage_path)) {
      entry(r.profile_id).photos.add(r.storage_path);
    }
  }
  for (const row of profRes.data ?? []) {
    const r = row as { id: string; photo_url?: string | null; pending_photo_url?: string | null };
    if (r.photo_url && ownsPhotoPath(r.id, r.photo_url)) entry(r.id).photos.add(r.photo_url);
    if (r.pending_photo_url && ownsPhotoPath(r.id, r.pending_photo_url)) {
      entry(r.id).photos.add(r.pending_photo_url);
    }
  }
  for (const row of privRes.data ?? []) {
    const r = row as { profile_id: string; id_document_url?: string | null };
    if (r.id_document_url && ownsIdDocPath(r.profile_id, r.id_document_url)) {
      entry(r.profile_id).idDocuments.add(r.id_document_url);
    }
  }
  for (const [pid, e] of sets) byProfile.set(pid, { photos: [...e.photos], idDocuments: [...e.idDocuments] });
  return { byProfile };
}

/** Removes the collected objects. Returns error messages rather than throwing. */
export async function removeMemberStorage(admin: SupabaseClient, paths: MemberStoragePaths): Promise<string[]> {
  const errors: string[] = [];
  if (paths.photos.length > 0) {
    const { error } = await admin.storage.from('profile-photos').remove(paths.photos);
    if (error) errors.push(`profile-photos: ${error.message}`);
  }
  if (paths.idDocuments.length > 0) {
    const { error } = await admin.storage.from('id-documents').remove(paths.idDocuments);
    if (error) errors.push(`id-documents: ${error.message}`);
  }
  return errors;
}

export function memberDisplayLabel(
  first: string | null | undefined,
  surname: string | null | undefined,
  referenceNumber: string | null | undefined
): string {
  const full = `${String(first ?? '').trim()} ${String(surname ?? '').trim()}`.trim();
  const ref = String(referenceNumber ?? '').trim();
  if (full && ref) return `${full} (${ref})`;
  if (full) return full;
  if (ref) return ref;
  return '';
}

/** Store display names on feedback rows before the profiles they point at are deleted. */
export async function snapshotFeedbackNamesForProfiles(admin: SupabaseClient, profileIds: string[]) {
  if (profileIds.length === 0) return;
  const chunkSize = 100;
  for (let i = 0; i < profileIds.length; i += chunkSize) {
    const chunk = profileIds.slice(i, i + chunkSize);
    const [{ data: profs }, { data: privs }] = await Promise.all([
      admin.from('profiles').select('id, first_name, reference_number').in('id', chunk),
      admin.from('member_private').select('profile_id, surname').in('profile_id', chunk),
    ]);
    const surnameBy = new Map(
      (privs ?? []).map((r) => {
        const row = r as { profile_id: string; surname: string | null };
        return [row.profile_id, row.surname] as const;
      })
    );
    for (const p of profs ?? []) {
      const row = p as { id: string; first_name: string; reference_number: string | null };
      const label = memberDisplayLabel(row.first_name, surnameBy.get(row.id) ?? null, row.reference_number);
      if (!label) continue;
      await admin
        .from('feedback')
        .update({ candidate_display_name: label })
        .eq('candidate_id', row.id)
        .is('candidate_display_name', null);
      await admin
        .from('feedback')
        .update({ requester_display_name: label })
        .eq('requester_id', row.id)
        .is('requester_display_name', null);
    }
  }
}
