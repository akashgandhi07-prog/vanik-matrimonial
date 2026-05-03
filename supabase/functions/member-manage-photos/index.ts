import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';

type ProfilePhotoRow = {
  id: string;
  profile_id: string;
  storage_path: string;
  position: number;
  is_primary: boolean;
};

const MAX_PHOTOS = 3;

function sanitizePath(v: unknown): string {
  return String(v ?? '').trim();
}

function indexFromUnknown(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return -1;
  return n;
}

function sortByPosition(rows: ProfilePhotoRow[]): ProfilePhotoRow[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

async function syncPrimaryPhoto(
  admin: ReturnType<typeof createClient>,
  profileId: string,
  rows: ProfilePhotoRow[]
) {
  const sorted = sortByPosition(rows);
  const primary = sorted.find((r) => r.is_primary) ?? sorted[0] ?? null;
  const { error } = await admin.from('profiles').update({ photo_url: primary?.storage_path ?? null }).eq('id', profileId);
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, auth_user_id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (profileErr || !profile?.id) {
    return jsonResponse({ error: 'Profile required' }, req, 403);
  }
  const profileId = profile.id as string;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const action = String(body.action ?? '').trim();
  const { data: beforeRows, error: listErr } = await admin
    .from('profile_photos')
    .select('id, profile_id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (listErr) return jsonResponse({ error: listErr.message }, req, 500);
  const currentRows = (beforeRows ?? []) as ProfilePhotoRow[];

  if (action === 'list') {
    return jsonResponse({ photos: currentRows }, req);
  }

  if (action === 'add') {
    const storagePath = sanitizePath(body.storage_path);
    if (!storagePath) return jsonResponse({ error: 'storage_path required' }, req, 400);
    if (currentRows.length >= MAX_PHOTOS) {
      return jsonResponse({ error: 'You can upload up to 3 photos.' }, req, 400);
    }
    const nextPos = currentRows.length;
    const shouldBePrimary = currentRows.length === 0;
    const { error: insertErr } = await admin.from('profile_photos').insert({
      profile_id: profileId,
      storage_path: storagePath,
      position: nextPos,
      is_primary: shouldBePrimary,
    });
    if (insertErr) return jsonResponse({ error: insertErr.message }, req, 500);
  } else if (action === 'remove') {
    const photoId = String(body.photo_id ?? '').trim();
    if (!photoId) return jsonResponse({ error: 'photo_id required' }, req, 400);
    const target = currentRows.find((r) => r.id === photoId);
    if (!target) return jsonResponse({ error: 'Photo not found' }, req, 404);
    const { error: delErr } = await admin.from('profile_photos').delete().eq('id', photoId).eq('profile_id', profileId);
    if (delErr) return jsonResponse({ error: delErr.message }, req, 500);
    await admin.storage.from('profile-photos').remove([target.storage_path]).catch(() => null);
  } else if (action === 'reorder') {
    const fromIndex = indexFromUnknown(body.from_index);
    const toIndex = indexFromUnknown(body.to_index);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= currentRows.length || toIndex >= currentRows.length) {
      return jsonResponse({ error: 'Invalid from_index or to_index' }, req, 400);
    }
    const reordered = [...currentRows];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      const row = reordered[i];
      if (row.position === i) continue;
      const { error } = await admin.from('profile_photos').update({ position: i }).eq('id', row.id).eq('profile_id', profileId);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    }
  } else if (action === 'set_primary') {
    const photoId = String(body.photo_id ?? '').trim();
    if (!photoId) return jsonResponse({ error: 'photo_id required' }, req, 400);
    if (!currentRows.some((r) => r.id === photoId)) return jsonResponse({ error: 'Photo not found' }, req, 404);
    // Clear primary first so we never have two rows with is_primary true (unique per profile_id).
    const { error: clearErr } = await admin
      .from('profile_photos')
      .update({ is_primary: false })
      .eq('profile_id', profileId);
    if (clearErr) return jsonResponse({ error: clearErr.message }, req, 500);
    const { error: primaryErr } = await admin
      .from('profile_photos')
      .update({ is_primary: true })
      .eq('id', photoId)
      .eq('profile_id', profileId);
    if (primaryErr) return jsonResponse({ error: primaryErr.message }, req, 500);
  } else {
    return jsonResponse({ error: 'Unknown action' }, req, 400);
  }

  const { data: afterRows, error: afterErr } = await admin
    .from('profile_photos')
    .select('id, profile_id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (afterErr) return jsonResponse({ error: afterErr.message }, req, 500);
  const normalized = (afterRows ?? []) as ProfilePhotoRow[];
  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    if (row.position === i) continue;
    const { error } = await admin.from('profile_photos').update({ position: i }).eq('id', row.id).eq('profile_id', profileId);
    if (error) return jsonResponse({ error: error.message }, req, 500);
  }
  const { data: finalRows, error: finalErr } = await admin
    .from('profile_photos')
    .select('id, profile_id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (finalErr) return jsonResponse({ error: finalErr.message }, req, 500);
  const rows = (finalRows ?? []) as ProfilePhotoRow[];

  // Guarantee exactly one primary when at least one photo exists.
  if (rows.length > 0 && !rows.some((r) => r.is_primary)) {
    const first = rows[0];
    const { error } = await admin.from('profile_photos').update({ is_primary: true }).eq('id', first.id).eq('profile_id', profileId);
    if (error) return jsonResponse({ error: error.message }, req, 500);
  }

  const { data: latestRows, error: latestErr } = await admin
    .from('profile_photos')
    .select('id, profile_id, storage_path, position, is_primary')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (latestErr) return jsonResponse({ error: latestErr.message }, req, 500);
  const latest = (latestRows ?? []) as ProfilePhotoRow[];
  await syncPrimaryPhoto(admin, profileId, latest);

  return jsonResponse({ ok: true, photos: latest }, req);
});
