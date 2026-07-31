import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type GalleryRow = { id: string; storage_path: string; position: number; is_primary: boolean };

/**
 * Point the profile's main gallery photo (profile_photos) at `newPath`,
 * preserving the invariants member-manage-photos maintains: packed positions,
 * exactly one primary row, and profiles.photo_url matching the primary.
 * Inserts the row when the gallery is empty (legacy profiles).
 *
 * Returns the storage paths the gallery still references afterwards so callers
 * can delete replaced objects without breaking rows that still point at them.
 */
export async function replacePrimaryGalleryPhoto(
  admin: SupabaseClient,
  profileId: string,
  newPath: string
): Promise<{ referenced: string[]; error?: string }> {
  const { data, error } = await admin
    .from('profile_photos')
    .select('id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (error) return { referenced: [], error: error.message };
  const rows = (data ?? []) as GalleryRow[];

  const primary = rows.find((r) => r.is_primary) ?? rows[0] ?? null;
  if (!primary) {
    const { error: insErr } = await admin.from('profile_photos').insert({
      profile_id: profileId,
      storage_path: newPath,
      position: 0,
      is_primary: true,
    });
    if (insErr) return { referenced: [], error: insErr.message };
  } else {
    // Another row already holding newPath would collide with UNIQUE(profile_id,
    // storage_path) once the primary points at it; it is a duplicate, drop it.
    for (const r of rows) {
      if (r.id !== primary.id && r.storage_path === newPath) {
        const { error: delErr } = await admin
          .from('profile_photos')
          .delete()
          .eq('id', r.id)
          .eq('profile_id', profileId);
        if (delErr) return { referenced: [], error: delErr.message };
      }
    }
    const { error: upErr } = await admin
      .from('profile_photos')
      .update({ storage_path: newPath, is_primary: true })
      .eq('id', primary.id)
      .eq('profile_id', profileId);
    if (upErr) return { referenced: [], error: upErr.message };
  }

  const { data: after, error: afterErr } = await admin
    .from('profile_photos')
    .select('id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (afterErr) return { referenced: [], error: afterErr.message };
  const packed = (after ?? []) as GalleryRow[];
  for (let i = 0; i < packed.length; i++) {
    if (packed[i].position === i) continue;
    const { error: posErr } = await admin
      .from('profile_photos')
      .update({ position: i })
      .eq('id', packed[i].id)
      .eq('profile_id', profileId);
    if (posErr) return { referenced: [], error: posErr.message };
  }

  const { error: syncErr } = await admin.from('profiles').update({ photo_url: newPath }).eq('id', profileId);
  if (syncErr) return { referenced: [], error: syncErr.message };

  return { referenced: packed.map((r) => r.storage_path) };
}
