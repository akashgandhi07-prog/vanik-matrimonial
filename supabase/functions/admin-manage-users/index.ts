import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { adminPowerRole, isSupportAdmin, metaIsAdminFlag, isUserAdmin } from '../_shared/auth-admin.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { dispatchEmail, type EmailType } from '../_shared/dispatch-email.ts';
import {
  isTransactionalMailConfigured,
  transactionalMailMissingReason,
  transactionalMailRuntimeStatus,
} from '../_shared/transactional-mail.ts';
import { publicSiteBaseUrl } from '../_shared/site-url.ts';
import { replacePrimaryGalleryPhoto } from '../_shared/profile-photos.ts';
import { stripHtml } from '../_shared/sanitize.ts';

type QueryErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

function memberDisplayLabel(
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

async function snapshotFeedbackNamesForProfiles(admin: { from: (table: string) => unknown }, profileIds: string[]) {
  if (profileIds.length === 0) return;
  const chunkSize = 200;
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

function normalizeQueryError(label: string, err: unknown): string | null {
  if (!err) return null;
  if (typeof err !== 'object') {
    const msg = String(err).trim();
    return msg ? `${label}: ${msg}` : `${label}: unknown query error`;
  }
  const e = err as QueryErrorLike;
  const parts = [e.message, e.code, e.details, e.hint]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  if (parts.length === 0) return `${label}: unknown query error`;
  return `${label}: ${parts.join(' | ')}`;
}

const CONTACT_QUOTA_WEEK_BASE = 3;
const CONTACT_QUOTA_MONTH_BASE = 6;
const CONTACT_QUOTA_BONUS_MAX = 50;

type ContactQuotaSnapshot = {
  weekly_used: number;
  monthly_used: number;
  weekly_cap: number;
  monthly_cap: number;
  weekly_bonus: number;
  monthly_bonus: number;
  week_reset_at: string | null;
  month_reset_at: string;
};

function contactQuotaFromRequests(
  requestRows: { created_at: string; candidate_ids: string[] | null }[],
  weeklyBonus: number,
  monthlyBonus: number
): ContactQuotaSnapshot {
  const now = Date.now();
  const weekCut = now - 7 * 86400000;
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const countDistinctSince = (cutoffMs: number) => {
    const s = new Set<string>();
    for (const r of requestRows) {
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t) || t < cutoffMs) continue;
      for (const id of r.candidate_ids ?? []) {
        if (id) s.add(id);
      }
    }
    return s.size;
  };
  const weeklyUsed = countDistinctSince(weekCut);
  const monthlyUsed = countDistinctSince(monthStart);
  const wB = Math.max(0, Math.min(CONTACT_QUOTA_BONUS_MAX, weeklyBonus));
  const mB = Math.max(0, Math.min(CONTACT_QUOTA_BONUS_MAX, monthlyBonus));
  const weeklyCap = CONTACT_QUOTA_WEEK_BASE + wB;
  const monthlyCap = CONTACT_QUOTA_MONTH_BASE + mB;
  let oldestInWeek: number | null = null;
  for (const r of requestRows) {
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t) || t < weekCut) continue;
    oldestInWeek = oldestInWeek === null ? t : Math.min(oldestInWeek, t);
  }
  const weekResetAt = oldestInWeek == null ? null : new Date(oldestInWeek + 7 * 86400000).toISOString();
  const monthResetAt = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();
  return {
    weekly_used: weeklyUsed,
    monthly_used: monthlyUsed,
    weekly_cap: weeklyCap,
    monthly_cap: monthlyCap,
    weekly_bonus: wB,
    monthly_bonus: mB,
    week_reset_at: weekResetAt,
    month_reset_at: monthResetAt,
  };
}

function csvEscapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[\r\n",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** PostgREST default limit can truncate bulk exports/listings; fetch every matching row. */
const ADMIN_PROFILE_PAGE_SIZE = 600;

// deno-lint-ignore no-explicit-any Supabase chained filter builder has no narrow public type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- aligned with Deno pragma above
async function fetchAllFilteredProfileRows(admin: any, f: string, selectCols: string): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const lapseCutoff = new Date(Date.now() - 365 * 864e5).toISOString();
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const nowIso = new Date().toISOString();
  const expires60Until = new Date(Date.now() + 60 * 864e5).toISOString();
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    let q = admin.from('profiles').select(selectCols);
    if (f === 'pending') q = q.eq('status', 'pending_approval');
    else if (f === 'active') q = q.eq('status', 'active');
    else if (f === 'expired') q = q.eq('status', 'expired');
    else if (f === 'rejected') q = q.eq('status', 'rejected');
    else if (f === 'closed') q = q.eq('status', 'closed');
    else if (f === 'matched') q = q.eq('hidden_reason', 'matched');
    else if (f === 'paused') q = q.eq('hidden_reason', 'member_paused');
    else if (f === 'hidden') q = q.eq('hidden_reason', 'admin');
    else if (f === 'lapsed90') q = q.eq('status', 'expired').lt('membership_expires_at', lapseCutoff);
    else if (f === 'rejected30') q = q.eq('status', 'rejected').gte('updated_at', since30);
    else if (f === 'photo_pending') q = q.not('pending_photo_url', 'is', null);
    else if (f === 'expires60') {
      q = q
        .eq('status', 'active')
        .not('membership_expires_at', 'is', null)
        .gte('membership_expires_at', nowIso)
        .lte('membership_expires_at', expires60Until);
    } else if (f !== 'all') return { rows: [], error: 'Invalid filter' };

    q = f === 'pending'
      ? q.order('pending_since', { ascending: true, nullsFirst: true })
      : q.order('created_at', { ascending: false });

    const { data, error } = await q.range(offset, offset + ADMIN_PROFILE_PAGE_SIZE - 1);
    if (error) return { rows: [], error: error.message };
    const chunk = (data ?? []) as Record<string, unknown>[];
    out.push(...chunk);
    if (chunk.length < ADMIN_PROFILE_PAGE_SIZE) break;
    offset += ADMIN_PROFILE_PAGE_SIZE;
  }
  return { rows: out, error: null };
}

/** Fetch every row of a table with a compact column list, paging past the PostgREST default limit. */
// deno-lint-ignore no-explicit-any Supabase chained filter builder has no narrow public type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- aligned with Deno pragma above
async function fetchAllTableRows(admin: any, table: string, selectCols: string, orderCol: string): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(selectCols)
      .order(orderCol, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { rows: [], error: error.message };
    const chunk = (data ?? []) as Record<string, unknown>[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return { rows: out, error: null };
}

/** Monday-start UTC week buckets covering the last `weeks` weeks (oldest first). */
function analyticsWeekBuckets(weeks: number): { startMs: number; week_start: string }[] {
  const now = new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset);
  const buckets: { startMs: number; week_start: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const startMs = thisMonday - i * 7 * 864e5;
    buckets.push({ startMs, week_start: new Date(startMs).toISOString().slice(0, 10) });
  }
  return buckets;
}

function analyticsWeekSeries(
  timestamps: (string | null | undefined)[],
  buckets: { startMs: number; week_start: string }[]
): { week_start: string; count: number }[] {
  const counts = new Array<number>(buckets.length).fill(0);
  const firstStart = buckets[0]?.startMs ?? 0;
  const weekMs = 7 * 864e5;
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t) || t < firstStart) continue;
    const idx = Math.floor((t - firstStart) / weekMs);
    if (idx >= 0 && idx < counts.length) counts[idx] += 1;
  }
  return buckets.map((b, i) => ({ week_start: b.week_start, count: counts[i] }));
}

/** Canonical column ids for `export_members_csv` (order preserved in output). Keep in sync with AdminMembers `MEMBER_EXPORT_COLUMN_OPTS`. */
const EXPORT_MEMBERS_CSV_COLUMNS = [
  'profile_id',
  'reference_number',
  'full_name',
  'first_name',
  'surname',
  'email',
  'mobile_phone',
  'gender',
  'seeking_gender',
  'age',
  'date_of_birth',
  'diet',
  'religion',
  'community',
  'education',
  'job_title',
  'height_cm',
  'weight_kg',
  'nationality',
  'place_of_birth',
  'town_country_of_origin',
  'future_settlement_plans',
  'hobbies',
  'home_address_line1',
  'home_address_city',
  'home_address_postcode',
  'home_address_country',
  'father_name',
  'mother_name',
  'status',
  'photo_status',
  'hidden_reason',
  'paused_at',
  'membership_expires_at',
  'last_request_at',
  'rejection_reason',
  'coupon_used',
  'id_document_uploaded',
  'pending_photo_change',
  'profile_created_at',
  'profile_updated_at',
  'private_record_created_at',
  'contact_request_weekly_bonus',
  'contact_request_monthly_bonus',
  'pause_reminder_sent_at',
  'delete_after',
  'staff_admin_notes',
  'id_document_deleted_at',
  'auth_user_id',
] as const;

type ExportMemberColumn = (typeof EXPORT_MEMBERS_CSV_COLUMNS)[number];

const EXPORT_MEMBERS_CSV_COLUMN_SET = new Set<string>(EXPORT_MEMBERS_CSV_COLUMNS);

const EXPORT_NEEDS_MEMBER_PRIVATE = new Set<string>([
  'full_name',
  'surname',
  'email',
  'mobile_phone',
  'date_of_birth',
  'home_address_line1',
  'home_address_city',
  'home_address_postcode',
  'home_address_country',
  'father_name',
  'mother_name',
  'coupon_used',
  'id_document_uploaded',
  'private_record_created_at',
  'contact_request_weekly_bonus',
  'contact_request_monthly_bonus',
  'id_document_deleted_at',
]);

const EXPORT_NEEDS_ADMIN_PROFILE_NOTES = new Set<string>(['staff_admin_notes']);

type PrivExportRow = {
  profile_id: string;
  surname: string | null;
  date_of_birth: string | null;
  email: string | null;
  mobile_phone: string | null;
  home_address_line1: string | null;
  home_address_city: string | null;
  home_address_postcode: string | null;
  home_address_country: string | null;
  father_name: string | null;
  mother_name: string | null;
  coupon_used: string | null;
  id_document_url: string | null;
  created_at: string | null;
  contact_request_weekly_bonus: number | null;
  contact_request_monthly_bonus: number | null;
  id_document_deleted_at: string | null;
};

function buildMemberExportValueMap(
  p: Record<string, unknown>,
  priv: PrivExportRow | undefined,
  staffNotesBody: string | undefined,
): Record<ExportMemberColumn, unknown> {
  const firstName = (p.first_name as string | null | undefined) ?? '';
  const surname = priv?.surname ?? '';
  const fullName = `${firstName} ${surname}`.trim();
  const idDoc = (priv?.id_document_url ?? '').trim();
  const pendingPh = (p.pending_photo_url as string | null | undefined) ?? '';
  return {
    profile_id: p.id ?? '',
    reference_number: p.reference_number ?? '',
    full_name: fullName,
    first_name: firstName,
    surname,
    email: priv?.email ?? '',
    mobile_phone: priv?.mobile_phone ?? '',
    gender: p.gender ?? '',
    seeking_gender: p.seeking_gender ?? '',
    age: p.age ?? '',
    date_of_birth: priv?.date_of_birth ?? '',
    diet: p.diet ?? '',
    religion: p.religion ?? '',
    community: p.community ?? '',
    education: p.education ?? '',
    job_title: p.job_title ?? '',
    height_cm: p.height_cm ?? '',
    weight_kg: p.weight_kg ?? '',
    nationality: p.nationality ?? '',
    place_of_birth: p.place_of_birth ?? '',
    town_country_of_origin: p.town_country_of_origin ?? '',
    future_settlement_plans: p.future_settlement_plans ?? '',
    hobbies: p.hobbies ?? '',
    home_address_line1: priv?.home_address_line1 ?? '',
    home_address_city: priv?.home_address_city ?? '',
    home_address_postcode: priv?.home_address_postcode ?? '',
    home_address_country: priv?.home_address_country ?? '',
    father_name: priv?.father_name ?? '',
    mother_name: priv?.mother_name ?? '',
    status: p.status ?? '',
    photo_status: p.photo_status ?? '',
    hidden_reason: p.hidden_reason ?? '',
    paused_at: p.paused_at ?? '',
    membership_expires_at: p.membership_expires_at ?? '',
    last_request_at: p.last_request_at ?? '',
    rejection_reason: p.rejection_reason ?? '',
    coupon_used: priv?.coupon_used ?? '',
    id_document_uploaded: idDoc ? 'yes' : 'no',
    pending_photo_change: pendingPh.trim() ? 'yes' : 'no',
    profile_created_at: p.created_at ?? '',
    profile_updated_at: p.updated_at ?? '',
    private_record_created_at: priv?.created_at ?? '',
    contact_request_weekly_bonus:
      priv?.contact_request_weekly_bonus === null || priv?.contact_request_weekly_bonus === undefined
        ? ''
        : priv.contact_request_weekly_bonus,
    contact_request_monthly_bonus:
      priv?.contact_request_monthly_bonus === null || priv?.contact_request_monthly_bonus === undefined
        ? ''
        : priv.contact_request_monthly_bonus,
    pause_reminder_sent_at: p.pause_reminder_sent_at ?? '',
    delete_after: p.delete_after ?? '',
    staff_admin_notes: staffNotesBody ?? '',
    id_document_deleted_at: priv?.id_document_deleted_at ?? '',
    auth_user_id: p.auth_user_id ?? '',
  };
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
  if (userErr || !userData.user || !isUserAdmin(userData.user)) {
    return jsonResponse({ error: 'Forbidden' }, req, 403);
  }

  const callerId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'mail_provider_status') {
    return jsonResponse(transactionalMailRuntimeStatus(), req);
  }

  if (action === 'list_profiles') {
    const f = typeof body.filter === 'string' ? body.filter : 'all';
    const { rows, error: fetchErr } = await fetchAllFilteredProfileRows(admin, f, '*');
    if (fetchErr) {
      return jsonResponse(
        { error: fetchErr === 'Invalid filter' ? 'Invalid filter' : fetchErr },
        req,
        fetchErr === 'Invalid filter' ? 400 : 500
      );
    }
    const profiles = rows;
    const emails: Record<string, string> = {};
    const surnamesByProfile: Record<string, string> = {};
    let pendingPreviews:
      | Record<string, { photo: string | null; photos: string[]; id_document: string | null; id_is_image: boolean }>
      | undefined;
    if (profiles.length > 0) {
      const ids = profiles.map((p: { id: string }) => p.id);
      const idDocByProfile = new Map<string, string | null>();
      const chunkSize = 600;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const idChunk = ids.slice(i, i + chunkSize);
        const { data: priv, error: mErr } = await admin
          .from('member_private')
          .select('profile_id, email, surname, id_document_url')
          .in('profile_id', idChunk);
        if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
        for (const r of priv ?? []) {
          const row = r as {
            profile_id: string;
            email: string | null;
            surname: string | null;
            id_document_url: string | null;
          };
          if (row.profile_id) {
            emails[row.profile_id] = row.email ?? '';
            surnamesByProfile[row.profile_id] = (row.surname ?? '').trim();
            idDocByProfile.set(row.profile_id, row.id_document_url ?? null);
          }
        }
      }
      if (f === 'pending') {
        pendingPreviews = {};
        const ttl = 1800;
        for (const p of profiles as { id: string; photo_url: string | null; photo_paths?: string[] | null }[]) {
          const photoSignedList: string[] = [];
          let idSigned: string | null = null;
          const photoPaths = Array.isArray(p.photo_paths)
            ? p.photo_paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
            : [];
          const uniquePaths = [...new Set(photoPaths)];
          const effectivePhotoPaths = uniquePaths.length > 0 ? uniquePaths : (p.photo_url ? [p.photo_url] : []);
          for (const path of effectivePhotoPaths) {
            const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(path, ttl);
            const signed = s?.signedUrl ?? null;
            if (signed) photoSignedList.push(signed);
          }
          const idPath = idDocByProfile.get(p.id) ?? '';
          const idLower = idPath.toLowerCase();
          const idIsImage =
            idLower.endsWith('.jpg') || idLower.endsWith('.jpeg') || idLower.endsWith('.png');
          if (idPath) {
            const { data: s } = await admin.storage.from('id-documents').createSignedUrl(idPath, ttl);
            idSigned = s?.signedUrl ?? null;
          }
          pendingPreviews[p.id] = {
            photo: photoSignedList[0] ?? null,
            photos: photoSignedList,
            id_document: idSigned,
            id_is_image: idIsImage,
          };
        }
      }
    }
    // Last sign-in lives in auth.users, so pull it once and map by auth_user_id.
    const lastSignInByAuthId = new Map<string, string | null>();
    {
      let page = 1;
      const perPage = 1000;
      for (;;) {
        const { data, error: auErr } = await admin.auth.admin.listUsers({ page, perPage });
        if (auErr) break;
        const batch = data?.users ?? [];
        for (const u of batch) {
          lastSignInByAuthId.set(u.id, (u as { last_sign_in_at?: string | null }).last_sign_in_at ?? null);
        }
        if (batch.length < perPage) break;
        page++;
      }
    }
    const profilesWithNames = profiles.map((p) => {
      const row = p as { id: string; first_name?: string | null; auth_user_id?: string | null };
      const first = (row.first_name ?? '').trim();
      const surname = surnamesByProfile[row.id] ?? '';
      const full_name = `${first} ${surname}`.trim() || first;
      const last_sign_in_at = row.auth_user_id ? lastSignInByAuthId.get(row.auth_user_id) ?? null : null;
      return { ...p, full_name, last_sign_in_at };
    });
    return jsonResponse(
      { profiles: profilesWithNames, emails, pending_previews: pendingPreviews },
      req
    );
  }

  if (action === 'export_members_csv') {
    const f = typeof body.filter === 'string' ? body.filter : 'all';
    const rawCols = Array.isArray(body.columns) ? body.columns : null;
    let selectedColumns: ExportMemberColumn[];
    if (!rawCols || rawCols.length === 0) {
      selectedColumns = [...EXPORT_MEMBERS_CSV_COLUMNS];
    } else {
      const requested = new Set(
        rawCols.filter((x): x is string => typeof x === 'string' && EXPORT_MEMBERS_CSV_COLUMN_SET.has(x))
      );
      if (requested.size === 0) {
        return jsonResponse(
          { error: 'columns must contain at least one valid id (see export field list)' },
          req,
          400
        );
      }
      selectedColumns = EXPORT_MEMBERS_CSV_COLUMNS.filter((c) => requested.has(c));
    }

    const profileSelect =
      'id, reference_number, first_name, gender, seeking_gender, age, education, job_title, height_cm, weight_kg, diet, religion, community, nationality, place_of_birth, town_country_of_origin, future_settlement_plans, hobbies, photo_status, status, hidden_reason, paused_at, pause_reminder_sent_at, delete_after, membership_expires_at, last_request_at, rejection_reason, created_at, updated_at, auth_user_id, pending_photo_url';

    const { rows: profRows, error: pErr } = await fetchAllFilteredProfileRows(admin, f, profileSelect);
    if (pErr) {
      return jsonResponse(
        { error: pErr === 'Invalid filter' ? 'Invalid filter' : pErr },
        req,
        pErr === 'Invalid filter' ? 400 : 500,
      );
    }

    const needsPrivate = selectedColumns.some((c) => EXPORT_NEEDS_MEMBER_PRIVATE.has(c));
    const needsNotes = selectedColumns.some((c) => EXPORT_NEEDS_ADMIN_PROFILE_NOTES.has(c));

    const privateByProfile = new Map<string, PrivExportRow>();
    if (needsPrivate && profRows.length > 0) {
      const ids = profRows.map((p) => String(p.id ?? '')).filter(Boolean);
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { data: priv, error: mErr } = await admin
          .from('member_private')
          .select(
            'profile_id, surname, date_of_birth, email, mobile_phone, home_address_line1, home_address_city, home_address_postcode, home_address_country, father_name, mother_name, coupon_used, id_document_url, created_at, contact_request_weekly_bonus, contact_request_monthly_bonus, id_document_deleted_at'
          )
          .in('profile_id', chunk);
        if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
        for (const r of priv ?? []) {
          const row = r as PrivExportRow;
          if (row.profile_id) privateByProfile.set(row.profile_id, row);
        }
      }
    }

    const notesByProfile = new Map<string, string>();
    if (needsNotes && profRows.length > 0) {
      const ids = profRows.map((p) => String(p.id ?? '')).filter(Boolean);
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { data: noteRows, error: nErr } = await admin
          .from('admin_profile_notes')
          .select('profile_id, body')
          .in('profile_id', chunk);
        if (nErr) return jsonResponse({ error: nErr.message }, req, 500);
        for (const r of noteRows ?? []) {
          const nr = r as { profile_id: string; body: string | null };
          if (nr.profile_id) notesByProfile.set(nr.profile_id, nr.body ?? '');
        }
      }
    }

    const lines: string[] = [
      selectedColumns.map((h) => csvEscapeCell(h)).join(','),
    ];
    for (const p of profRows) {
      const pid = String(p.id ?? '');
      const priv = pid ? privateByProfile.get(pid) : undefined;
      const staffNotes = pid ? notesByProfile.get(pid) : undefined;
      const valueMap = buildMemberExportValueMap(p, priv, staffNotes);
      lines.push(selectedColumns.map((c) => csvEscapeCell(valueMap[c])).join(','));
    }

    const csv = lines.join('\n');

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'export_members_csv',
      notes:
        `filter=${f} cols=${selectedColumns.join('|')} rows=${profRows.length}`.slice(0, 30000),
    });

    return jsonResponse(
      {
        csv,
        row_count: profRows.length,
        filter: f,
        columns: selectedColumns,
      },
      req
    );
  }

  if (action === 'delete_members_permanent') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const confirmText = typeof body.confirm_text === 'string' ? body.confirm_text.trim() : '';
    if (confirmText !== 'DELETE') {
      return jsonResponse({ error: 'You must send confirm_text exactly DELETE' }, req, 400);
    }
    const rawIds = Array.isArray(body.profile_ids)
      ? body.profile_ids.filter((x): x is string => typeof x === 'string')
      : [];
    const profileIds = [...new Set(rawIds.map((x) => x.trim()).filter(Boolean))];
    if (profileIds.length === 0 || profileIds.length > 80) {
      return jsonResponse({ error: 'profile_ids required: 1-80 unique UUIDs' }, req, 400);
    }

    const deleted: string[] = [];
    const failed: { profile_id: string; error: string }[] = [];

    const { data: profRows, error: profErr } = await admin
      .from('profiles')
      .select('id, auth_user_id')
      .in('id', profileIds);
    if (profErr) return jsonResponse({ error: profErr.message }, req, 500);

    const uidByProfile = new Map<string, string>(
      (profRows ?? []).map((r: { id: string; auth_user_id: string }) => [r.id, r.auth_user_id])
    );

    type Pair = { profile_id: string; auth_user_id: string };
    const toDelete: Pair[] = [];

    for (const pid of profileIds) {
      const uid = uidByProfile.get(pid);
      if (!uid) {
        failed.push({ profile_id: pid, error: 'Profile not found' });
        continue;
      }
      if (uid === callerId) {
        failed.push({ profile_id: pid, error: 'Cannot delete your own account' });
        continue;
      }
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(uid);
      if (authErr || !authUser?.user) {
        failed.push({
          profile_id: pid,
          error: authErr?.message ?? 'Auth user not found',
        });
        continue;
      }
      const am = authUser.user.app_metadata as Record<string, unknown> | undefined;
      if (metaIsAdminFlag(am?.is_admin)) {
        failed.push({ profile_id: pid, error: 'Cannot delete an admin user' });
        continue;
      }
      toDelete.push({ profile_id: pid, auth_user_id: uid });
    }

    if (toDelete.length > 0) {
      const okProfileIds = toDelete.map((p) => p.profile_id);

      const { data: photoRows } = await admin
        .from('profile_photos')
        .select('storage_path')
        .in('profile_id', okProfileIds);
      const photoPaths = new Set<string>();
      for (const row of photoRows ?? []) {
        const path = (row as { storage_path?: string }).storage_path;
        if (path) photoPaths.add(path);
      }
      const { data: profExtras } = await admin
        .from('profiles')
        .select('photo_url, pending_photo_url')
        .in('id', okProfileIds);
      for (const row of profExtras ?? []) {
        const r = row as { photo_url?: string | null; pending_photo_url?: string | null };
        if (r.photo_url) photoPaths.add(r.photo_url);
        if (r.pending_photo_url) photoPaths.add(r.pending_photo_url);
      }
      const photoList = [...photoPaths];
      if (photoList.length > 0) {
        const { error: remPh } = await admin.storage.from('profile-photos').remove(photoList);
        if (remPh) console.error('delete_members_permanent profile-photos remove', remPh);
      }

      const { data: privRows } = await admin
        .from('member_private')
        .select('id_document_url')
        .in('profile_id', okProfileIds);
      const idPaths = [
        ...new Set(
          (privRows ?? [])
            .map((row) => (row as { id_document_url?: string | null }).id_document_url)
            .filter((x): x is string => typeof x === 'string' && x.length > 0)
        ),
      ];
      if (idPaths.length > 0) {
        const { error: remId } = await admin.storage.from('id-documents').remove(idPaths);
        if (remId) console.error('delete_members_permanent id-documents remove', remId);
      }

      await admin.from('admin_actions').update({ target_profile_id: null }).in('target_profile_id', okProfileIds);
      await admin.from('email_log').update({ recipient_profile_id: null }).in('recipient_profile_id', okProfileIds);
      await snapshotFeedbackNamesForProfiles(admin, okProfileIds);
      await admin.from('requests').update({ requester_id: null }).in('requester_id', okProfileIds);
      await admin.from('feedback').update({ candidate_id: null }).in('candidate_id', okProfileIds);
      await admin.from('feedback').update({ requester_id: null }).in('requester_id', okProfileIds);

      for (const { profile_id: pid, auth_user_id: uid } of toDelete) {
        const { error: delErr } = await admin.auth.admin.deleteUser(uid);
        if (delErr) {
          failed.push({ profile_id: pid, error: delErr.message });
          continue;
        }
        deleted.push(pid);
      }
    }

    if (deleted.length > 0) {
      const note = `count=${deleted.length} deleted=${deleted.join(',')}`.slice(0, 30000);
      await admin.from('admin_actions').insert({
        admin_user_id: callerId,
        target_profile_id: null,
        action_type: 'bulk_permanent_delete',
        notes: note,
      });
    }

    return jsonResponse({ ok: true, deleted, failed }, req);
  }

  if (action === 'export_emails') {
    const rawStatuses = Array.isArray(body.statuses) ? body.statuses : [];
    const allowed = new Set([
      'active',
      'pending',
      'expires60',
      'expired',
      'lapsed90',
      'rejected30',
      'closed',
      'matched',
      'paused',
      'hidden',
    ]);
    const statuses = [...new Set(rawStatuses.filter((x): x is string => typeof x === 'string' && allowed.has(x)))];
    if (statuses.length === 0) {
      return jsonResponse(
        { error: 'statuses required: non-empty array of active|pending|expires60|expired|lapsed90|rejected30|closed|matched|paused|hidden' },
        req,
        400
      );
    }

    const lapseCutoff = new Date(Date.now() - 365 * 864e5).toISOString();
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const nowIso = new Date().toISOString();
    const expires60Until = new Date(Date.now() + 60 * 864e5).toISOString();

    const profileIdSet = new Set<string>();
    const counts: Record<string, number> = {};

    for (const f of statuses) {
      let q = admin.from('profiles').select('id');
      if (f === 'pending') q = q.eq('status', 'pending_approval');
      else if (f === 'active') q = q.eq('status', 'active');
      else if (f === 'expired') q = q.eq('status', 'expired');
      else if (f === 'rejected30') q = q.eq('status', 'rejected').gte('updated_at', since30);
      else if (f === 'closed') q = q.eq('status', 'closed');
      else if (f === 'matched') q = q.eq('hidden_reason', 'matched');
      else if (f === 'paused') q = q.eq('hidden_reason', 'member_paused');
      else if (f === 'hidden') q = q.eq('hidden_reason', 'admin');
      else if (f === 'lapsed90') {
        q = q.eq('status', 'expired').lt('membership_expires_at', lapseCutoff);
      } else if (f === 'expires60') {
        q = q
          .eq('status', 'active')
          .not('membership_expires_at', 'is', null)
          .gte('membership_expires_at', nowIso)
          .lte('membership_expires_at', expires60Until);
      } else {
        return jsonResponse({ error: 'Invalid filter in statuses' }, req, 400);
      }

      const { data: profRows, error: pErr } = await q;
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      const ids = (profRows ?? []).map((row: { id: string }) => row.id);
      counts[f] = ids.length;
      for (const id of ids) profileIdSet.add(id);
    }

    const allIds = [...profileIdSet];
    const seenLower = new Map<string, string>();
    const chunkSize = 500;
    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);
      const { data: priv, error: mErr } = await admin
        .from('member_private')
        .select('email')
        .in('profile_id', chunk);
      if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
      for (const r of priv ?? []) {
        const row = r as { email: string | null };
        const raw = (row.email ?? '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!seenLower.has(key)) seenLower.set(key, raw);
      }
    }

    const emails = [...seenLower.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'email_export',
      notes: `groups=${statuses.join(',')} unique_emails=${emails.length} profiles_union=${profileIdSet.size}`.slice(0, 30000),
    });

    return jsonResponse(
      {
        emails,
        counts,
        total: emails.length,
        profiles_union: profileIdSet.size,
      },
      req
    );
  }

  if (action === 'list') {
    const users: Array<{
      id: string;
      email: string | undefined;
      is_admin: boolean;
      admin_role: 'super' | 'support' | null;
      created_at: string;
    }> = [];
    let page = 1;
    const perPage = 1000;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ error: error.message }, req, 500);
      const batch = data?.users ?? [];
      for (const u of batch) {
        const am = u.app_metadata as Record<string, unknown> | undefined;
        const adminFlag = metaIsAdminFlag(am?.is_admin);
        const ar = am?.admin_role === 'support' ? 'support' : am?.admin_role === 'super' ? 'super' : null;
        users.push({
          id: u.id,
          email: u.email,
          is_admin: adminFlag,
          admin_role: adminFlag ? (ar ?? 'super') : null,
          created_at: u.created_at,
        });
      }
      if (batch.length < perPage) break;
      page++;
    }
    users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    return jsonResponse({ users }, req);
  }

  if (action === 'overview_metrics') {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const monthEnd = new Date();
    monthEnd.setDate(monthEnd.getDate() + 30);
    const lapseCutoff = new Date(Date.now() - 365 * 864e5).toISOString();
    const nowIso = new Date().toISOString();

    const [
      pending,
      requestsWeek,
      expiring,
      flagged,
      lapsed90,
      actRes,
      activeMembers,
      photoPendingReview,
      paidRegSessions,
    ] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
      admin.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('membership_expires_at', monthEnd.toISOString())
        .gte('membership_expires_at', nowIso),
      admin
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('is_flagged', true)
        .is('archived_at', null),
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'expired')
        .lt('membership_expires_at', lapseCutoff),
      admin
        .from('admin_actions')
        .select('id, action_type, created_at, notes, admin_user_id, target_profile_id')
        .order('created_at', { ascending: false })
        .limit(20),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).not('pending_photo_url', 'is', null),
      admin
        .from('stripe_checkout_sessions')
        .select('checkout_session_id', { count: 'exact', head: true })
        .eq('purpose', 'registration')
        .eq('payment_status', 'paid'),
    ]);

    const errors = [
      normalizeQueryError('pending profiles', pending.error),
      normalizeQueryError('weekly requests', requestsWeek.error),
      normalizeQueryError('expiring members', expiring.error),
      normalizeQueryError('flagged feedback', flagged.error),
      normalizeQueryError('long-lapsed members', lapsed90.error),
      normalizeQueryError('recent actions', actRes.error),
      normalizeQueryError('active members', activeMembers.error),
      normalizeQueryError('photo pending review', photoPendingReview.error),
      normalizeQueryError('paid registration sessions', paidRegSessions.error),
    ].filter((e): e is string => typeof e === 'string' && e.length > 0);
    if (errors.length) {
      return jsonResponse({ error: [...new Set(errors)].join(' ') }, req, 500);
    }

    const rawActions = (actRes.data ?? []) as {
      id: string;
      action_type: string;
      created_at: string;
      notes: string | null;
      admin_user_id: string | null;
      target_profile_id: string | null;
    }[];

    const adminIds = [
      ...new Set(
        rawActions
          .map((a) => a.admin_user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const adminEmailByUserId: Record<string, string | null> = {};
    for (const uid of adminIds) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      adminEmailByUserId[uid] = u.user?.email ?? null;
    }

    const targetIds = [
      ...new Set(
        rawActions
          .map((a) => a.target_profile_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const targetByProfileId: Record<string, { first_name: string; reference_number: string | null }> = {};
    if (targetIds.length > 0) {
      const { data: targetProfiles, error: tErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number')
        .in('id', targetIds);
      if (tErr) return jsonResponse({ error: tErr.message }, req, 500);
      for (const p of targetProfiles ?? []) {
        const row = p as { id: string; first_name: string; reference_number: string | null };
        targetByProfileId[row.id] = {
          first_name: row.first_name,
          reference_number: row.reference_number,
        };
      }
    }

    const enrichedActions = rawActions.map((a) => ({
      id: a.id,
      action_type: a.action_type,
      created_at: a.created_at,
      notes: a.notes,
      admin_user_id: a.admin_user_id,
      admin_email: a.admin_user_id ? adminEmailByUserId[a.admin_user_id] ?? null : null,
      target_profile_id: a.target_profile_id,
      target_profile: a.target_profile_id ? targetByProfileId[a.target_profile_id] ?? null : null,
    }));

    return jsonResponse({
      metrics: {
        pending: pending.count ?? 0,
        requestsWeek: requestsWeek.count ?? 0,
        expiring: expiring.count ?? 0,
        flagged: flagged.count ?? 0,
        lapsed90: lapsed90.count ?? 0,
        activeMembers: activeMembers.count ?? 0,
        photoPendingReview: photoPendingReview.count ?? 0,
        paidRegistrationSessions: paidRegSessions.count ?? 0,
      },
      actions: enrichedActions,
      caller_role: adminPowerRole(userData.user),
    }, req);
  }

  if (action === 'list_referrals') {
    // Every member who registered with a referral code, newest first, with the
    // referrer resolved by name and the reward status from public.referrals.
    const { data: referredPrivRows, error: rpErr } = await admin
      .from('member_private')
      .select('profile_id, referred_by_code, surname')
      .not('referred_by_code', 'is', null);
    if (rpErr) return jsonResponse({ error: rpErr.message }, req, 500);
    const referredPriv = (referredPrivRows ?? []) as {
      profile_id: string;
      referred_by_code: string;
      surname: string | null;
    }[];

    const referredIds = referredPriv.map((r) => r.profile_id);
    const codes = [...new Set(referredPriv.map((r) => r.referred_by_code))];

    const profilesById = new Map<
      string,
      { first_name: string | null; status: string; created_at: string; reference_number: string | null }
    >();
    if (referredIds.length > 0) {
      const { data: profs, error: prErr } = await admin
        .from('profiles')
        .select('id, first_name, status, created_at, reference_number')
        .in('id', referredIds);
      if (prErr) return jsonResponse({ error: prErr.message }, req, 500);
      for (const p of (profs ?? []) as {
        id: string;
        first_name: string | null;
        status: string;
        created_at: string;
        reference_number: string | null;
      }[]) {
        profilesById.set(p.id, p);
      }
    }

    // Resolve each code to its owning (referrer) member.
    const referrerByCode = new Map<
      string,
      { profile_id: string; first_name: string | null; surname: string | null; reference_number: string | null }
    >();
    if (codes.length > 0) {
      const { data: refOwners, error: roErr } = await admin
        .from('member_private')
        .select('profile_id, referral_code, surname')
        .in('referral_code', codes);
      if (roErr) return jsonResponse({ error: roErr.message }, req, 500);
      const owners = (refOwners ?? []) as { profile_id: string; referral_code: string; surname: string | null }[];
      const ownerIds = owners.map((o) => o.profile_id);
      const ownerProfiles = new Map<string, { first_name: string | null; reference_number: string | null }>();
      if (ownerIds.length > 0) {
        const { data: ops } = await admin
          .from('profiles')
          .select('id, first_name, reference_number')
          .in('id', ownerIds);
        for (const p of (ops ?? []) as { id: string; first_name: string | null; reference_number: string | null }[]) {
          ownerProfiles.set(p.id, p);
        }
      }
      for (const o of owners) {
        const op = ownerProfiles.get(o.profile_id);
        referrerByCode.set(o.referral_code, {
          profile_id: o.profile_id,
          first_name: op?.first_name ?? null,
          surname: o.surname,
          reference_number: op?.reference_number ?? null,
        });
      }
    }

    const rewardByReferredId = new Map<
      string,
      { rewarded_at: string | null; referrer_months: number | null; referred_months: number | null }
    >();
    if (referredIds.length > 0) {
      const { data: rewRows } = await admin
        .from('referrals')
        .select('referred_profile_id, rewarded_at, referrer_months, referred_months')
        .in('referred_profile_id', referredIds);
      for (const r of (rewRows ?? []) as {
        referred_profile_id: string;
        rewarded_at: string | null;
        referrer_months: number | null;
        referred_months: number | null;
      }[]) {
        rewardByReferredId.set(r.referred_profile_id, r);
      }
    }

    const rows = referredPriv
      .map((r) => {
        const prof = profilesById.get(r.profile_id);
        const referrer = referrerByCode.get(r.referred_by_code) ?? null;
        const reward = rewardByReferredId.get(r.profile_id) ?? null;
        return {
          referred_profile_id: r.profile_id,
          referred_first_name: prof?.first_name ?? null,
          referred_surname: r.surname,
          referred_status: prof?.status ?? 'unknown',
          referred_reference_number: prof?.reference_number ?? null,
          registered_at: prof?.created_at ?? null,
          code_used: r.referred_by_code,
          referrer_profile_id: referrer?.profile_id ?? null,
          referrer_first_name: referrer?.first_name ?? null,
          referrer_surname: referrer?.surname ?? null,
          referrer_reference_number: referrer?.reference_number ?? null,
          rewarded_at: reward?.rewarded_at ?? null,
          referrer_months: reward?.referrer_months ?? null,
          referred_months: reward?.referred_months ?? null,
        };
      })
      .sort((a, b) => (b.registered_at ?? '').localeCompare(a.registered_at ?? ''));

    const totalMonthsAwarded = rows.reduce((s, r) => s + (r.referrer_months ?? 0) + (r.referred_months ?? 0), 0);
    return jsonResponse(
      {
        rows,
        totals: {
          total: rows.length,
          accepted: rows.filter((r) => r.rewarded_at != null || r.referrer_months != null || r.referred_months != null).length,
          months_awarded: totalMonthsAwarded,
        },
      },
      req
    );
  }

  if (action === 'list_requests') {
    const page = typeof body.page === 'number' && body.page >= 1 ? Math.floor(body.page) : 1;
    const pageSize =
      typeof body.page_size === 'number' && body.page_size >= 1 && body.page_size <= 200
        ? Math.floor(body.page_size)
        : 50;
    const from = (page - 1) * pageSize;
    const to = page * pageSize - 1;
    const { data: requestRows, error: rErr } = await admin
      .from('requests')
      .select('id, created_at, requester_id, candidate_ids')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (rErr) return jsonResponse({ error: rErr.message }, req, 500);

    const rows = requestRows ?? [];
    const idSet = new Set<string>();
    for (const r of rows as { requester_id?: string; candidate_ids?: string[] }[]) {
      if (r.requester_id) idSet.add(r.requester_id);
      for (const c of r.candidate_ids ?? []) idSet.add(c);
    }
    const names: Record<string, string> = {};
    if (idSet.size > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number')
        .in('id', [...idSet]);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as { id: string; first_name: string; reference_number: string | null };
        names[row.id] = `${row.first_name} (${row.reference_number ?? '-'})`;
      }
    }
    return jsonResponse({ requests: rows, names }, req);
  }

  if (action === 'manage_feedback') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot manage feedback' }, req, 403);
    }
    const kind = body.kind === 'website' ? 'website' : 'introduction';
    const op =
      body.op === 'archive' || body.op === 'delete' || body.op === 'restore' ? body.op : null;
    if (!op) {
      return jsonResponse({ error: 'op must be archive, delete, or restore' }, req, 400);
    }
    const rawIds = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string')
      : [];
    const ids = [...new Set(rawIds.map((x) => x.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > 100) {
      return jsonResponse({ error: 'ids required: 1-100 unique UUIDs' }, req, 400);
    }
    const table = kind === 'website' ? 'website_feedback' : 'feedback';
    const now = new Date().toISOString();

    if (op === 'delete') {
      const { error } = await admin.from(table).delete().in('id', ids);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    } else if (op === 'archive') {
      const { error } = await admin
        .from(table)
        .update({ archived_at: now })
        .in('id', ids)
        .is('archived_at', null);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    } else {
      const { error } = await admin
        .from(table)
        .update({ archived_at: null })
        .in('id', ids)
        .not('archived_at', 'is', null);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    }

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: `feedback_${op}`,
      notes: `kind=${kind} count=${ids.length}`.slice(0, 30000),
    });

    return jsonResponse({ ok: true, affected: ids.length }, req);
  }

  if (action === 'list_feedback') {
    const includeArchived = body.include_archived === true;
    let fbQuery = admin
      .from('feedback')
      .select(
        'id, request_id, candidate_id, requester_id, direction, candidate_display_name, requester_display_name, made_contact, recommend_retain, notes, is_flagged, submitted_at, archived_at'
      )
      .order('submitted_at', { ascending: false });
    if (!includeArchived) {
      fbQuery = fbQuery.is('archived_at', null);
    }
    const { data: fb, error: fErr } = await fbQuery;
    if (fErr) return jsonResponse({ error: fErr.message }, req, 500);
    const feedbackRows = fb ?? [];
    const requestIds = [
      ...new Set(
        feedbackRows
          .map((r) => (r as { request_id?: string | null }).request_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const requestsById = new Map<string, { requester_id: string | null; candidate_ids: string[] | null }>();
    const reqChunk = 400;
    for (let i = 0; i < requestIds.length; i += reqChunk) {
      const chunk = requestIds.slice(i, i + reqChunk);
      const { data: reqs, error: rqErr } = await admin
        .from('requests')
        .select('id, requester_id, candidate_ids')
        .in('id', chunk);
      if (rqErr) return jsonResponse({ error: rqErr.message }, req, 500);
      for (const r of reqs ?? []) {
        const row = r as { id: string; requester_id: string | null; candidate_ids: string[] | null };
        requestsById.set(row.id, row);
      }
    }

    const profileIds = new Set<string>();
    for (const r of feedbackRows as {
      candidate_id: string | null;
      requester_id: string | null;
      request_id: string | null;
    }[]) {
      const req = r.request_id ? requestsById.get(r.request_id) : undefined;
      const cands = req?.candidate_ids ?? [];
      const resolvedCandidate =
        r.candidate_id ?? (cands.length === 1 ? cands[0] : null);
      const resolvedRequester = r.requester_id ?? req?.requester_id ?? null;
      if (resolvedCandidate) profileIds.add(resolvedCandidate);
      if (resolvedRequester) profileIds.add(resolvedRequester);
    }

    const profiles: Record<
      string,
      {
        id: string;
        first_name: string;
        reference_number: string | null;
        full_name: string;
        status: string;
        hidden_reason: string | null;
      }
    > = {};
    const surnameByProfile = new Map<string, string | null>();
    const idList = [...profileIds];
    const profChunk = 400;
    for (let i = 0; i < idList.length; i += profChunk) {
      const chunk = idList.slice(i, i + profChunk);
      const [{ data: profs, error: pErr }, { data: privs, error: privErr }] = await Promise.all([
        admin.from('profiles').select('id, first_name, reference_number, status, hidden_reason').in('id', chunk),
        admin.from('member_private').select('profile_id, surname').in('profile_id', chunk),
      ]);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      if (privErr) return jsonResponse({ error: privErr.message }, req, 500);
      for (const pr of privs ?? []) {
        const row = pr as { profile_id: string; surname: string | null };
        surnameByProfile.set(row.profile_id, row.surname);
      }
      for (const p of profs ?? []) {
        const row = p as {
          id: string;
          first_name: string;
          reference_number: string | null;
          status: string;
          hidden_reason: string | null;
        };
        const full_name = memberDisplayLabel(
          row.first_name,
          surnameByProfile.get(row.id) ?? null,
          row.reference_number
        );
        profiles[row.id] = { ...row, full_name: full_name || row.first_name };
      }
    }
    return jsonResponse({ feedback: feedbackRows, profiles, requests: Object.fromEntries(requestsById) }, req);
  }

  if (action === 'list_website_feedback') {
    const includeArchived = body.include_archived === true;
    let wQuery = admin
      .from('website_feedback')
      .select(
        'id, profile_id, reporter_email, how_improve, things_good, things_bad, suggestions_future, submitted_at, archived_at'
      )
      .order('submitted_at', { ascending: false });
    if (!includeArchived) {
      wQuery = wQuery.is('archived_at', null);
    }
    const { data: rows, error: wErr } = await wQuery;
    if (wErr) return jsonResponse({ error: wErr.message }, req, 500);
    const list = rows ?? [];
    const pidSet = new Set<string>();
    for (const r of list as { profile_id?: string | null }[]) {
      if (r.profile_id) pidSet.add(r.profile_id);
    }
    const profiles: Record<string, { id: string; first_name: string; reference_number: string | null }> = {};
    if (pidSet.size > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number')
        .in('id', [...pidSet]);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as { id: string; first_name: string; reference_number: string | null };
        profiles[row.id] = row;
      }
    }
    return jsonResponse({ website_feedback: list, profiles }, req);
  }

  if (action === 'settings_stats') {
    const statuses = [
      'pending_approval',
      'active',
      'expired',
      'rejected',
      'closed',
    ] as const;
    const countPromises = statuses.map((s) =>
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('status', s)
    );
    // Off-register reasons are counted separately now that they are no longer statuses.
    const reasons = ['matched', 'member_paused', 'admin'] as const;
    const reasonPromises = reasons.map((r) =>
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('hidden_reason', r)
    );
    const [counts, reasonCounts, reqC, fbC, emailAttempted, emailOk] = await Promise.all([
      Promise.all(countPromises),
      Promise.all(reasonPromises),
      admin.from('requests').select('id', { count: 'exact', head: true }),
      admin.from('feedback').select('id', { count: 'exact', head: true }),
      admin.from('email_log').select('id', { count: 'exact', head: true }).not('resend_message_id', 'is', null),
      admin.from('email_log').select('id', { count: 'exact', head: true }).in('status', ['sent', 'delivered']),
    ]);

    for (const c of [...counts, ...reasonCounts]) {
      if (c.error) return jsonResponse({ error: c.error.message }, req, 500);
    }
    if (reqC.error) return jsonResponse({ error: reqC.error.message }, req, 500);
    if (fbC.error) return jsonResponse({ error: fbC.error.message }, req, 500);
    if (emailAttempted.error) return jsonResponse({ error: emailAttempted.error.message }, req, 500);
    if (emailOk.error) return jsonResponse({ error: emailOk.error.message }, req, 500);

    const byStatus: Record<string, number> = {};
    statuses.forEach((s, i) => {
      byStatus[s] = counts[i].count ?? 0;
    });
    const byHiddenReason: Record<string, number> = {};
    reasons.forEach((r, i) => {
      byHiddenReason[r] = reasonCounts[i].count ?? 0;
    });
    return jsonResponse({
      byStatus,
      byHiddenReason,
      requests: reqC.count ?? 0,
      feedback: fbC.count ?? 0,
      emailAttempted: emailAttempted.count ?? 0,
      emailOk: emailOk.count ?? 0,
    }, req);
  }

  if (action === 'analytics_stats') {
    const WEEKS = 12;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const in30Iso = new Date(nowMs + 30 * 864e5).toISOString();
    const in60Iso = new Date(nowMs + 60 * 864e5).toISOString();

    // Tables are small (hundreds of rows), so aggregate compact selects in TypeScript.
    const [profilesRes, requestsRes, referralsRes] = await Promise.all([
      fetchAllTableRows(
        admin,
        'profiles',
        'id, first_name, reference_number, status, hidden_reason, gender, age, created_at, membership_expires_at',
        'created_at'
      ),
      fetchAllTableRows(admin, 'requests', 'id, created_at, requester_id, candidate_ids', 'created_at'),
      fetchAllTableRows(
        admin,
        'referrals',
        'referrer_profile_id, referred_profile_id, code_used, referrer_months, referred_months, rewarded_at, created_at',
        'created_at'
      ),
    ]);
    for (const [label, res] of [
      ['profiles', profilesRes],
      ['requests', requestsRes],
      ['referrals', referralsRes],
    ] as const) {
      if (res.error) return jsonResponse({ error: `${label}: ${res.error}` }, req, 500);
    }

    const [fbTotal, fbYes, fbNo, fbUnsure, fbFlagged, fbArchived] = await Promise.all([
      admin.from('feedback').select('id', { count: 'exact', head: true }),
      admin.from('feedback').select('id', { count: 'exact', head: true }).eq('recommend_retain', 'yes'),
      admin.from('feedback').select('id', { count: 'exact', head: true }).eq('recommend_retain', 'no'),
      admin.from('feedback').select('id', { count: 'exact', head: true }).eq('recommend_retain', 'unsure'),
      admin
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('is_flagged', true)
        .is('archived_at', null),
      admin.from('feedback').select('id', { count: 'exact', head: true }).not('archived_at', 'is', null),
    ]);
    for (const c of [fbTotal, fbYes, fbNo, fbUnsure, fbFlagged, fbArchived]) {
      if (c.error) return jsonResponse({ error: c.error.message }, req, 500);
    }

    const profiles = profilesRes.rows as {
      id: string;
      first_name: string | null;
      reference_number: string | null;
      status: string;
      hidden_reason: string | null;
      gender: string | null;
      age: number | null;
      created_at: string;
      membership_expires_at: string | null;
    }[];
    const requestRows = requestsRes.rows as {
      id: string;
      created_at: string;
      requester_id: string | null;
      candidate_ids: string[] | null;
    }[];
    const referralRows = referralsRes.rows as {
      referrer_profile_id: string;
      referred_profile_id: string;
      code_used: string;
      referrer_months: number | null;
      referred_months: number | null;
      rewarded_at: string | null;
      created_at: string;
    }[];

    const labelById = new Map<string, string>();
    for (const p of profiles) {
      labelById.set(p.id, memberDisplayLabel(p.first_name, null, p.reference_number) || 'Unknown');
    }

    // ---- Member counts by state and gender ----
    const byStatus: Record<string, number> = {
      pending_approval: 0,
      active: 0,
      expired: 0,
      rejected: 0,
      closed: 0,
    };
    const byHiddenReason: Record<string, number> = { member_paused: 0, matched: 0, admin: 0 };
    const byGender: Record<string, number> = { Male: 0, Female: 0 };
    const activeByGender: Record<string, number> = { Male: 0, Female: 0 };
    let expiring30 = 0;
    let expiring60 = 0;
    for (const p of profiles) {
      if (p.status in byStatus) byStatus[p.status] += 1;
      if (p.hidden_reason && p.hidden_reason in byHiddenReason) byHiddenReason[p.hidden_reason] += 1;
      if (p.gender && p.gender in byGender) byGender[p.gender] += 1;
      if (p.status === 'active') {
        if (p.gender && p.gender in activeByGender) activeByGender[p.gender] += 1;
        const exp = p.membership_expires_at;
        if (exp && exp >= nowIso) {
          if (exp <= in30Iso) expiring30 += 1;
          if (exp <= in60Iso) expiring60 += 1;
        }
      }
    }

    // ---- Age profile of active members, split by gender ----
    const AGE_BANDS = [
      { key: '18-25', min: 18, max: 25 },
      { key: '26-30', min: 26, max: 30 },
      { key: '31-35', min: 31, max: 35 },
      { key: '36-40', min: 36, max: 40 },
      { key: '41-50', min: 41, max: 50 },
      { key: '51+', min: 51, max: 200 },
    ];
    const ageBands = AGE_BANDS.map((b) => ({ band: b.key, Male: 0, Female: 0, total: 0 }));
    let ageUnknown = 0;
    for (const p of profiles) {
      if (p.status !== 'active') continue;
      const age = typeof p.age === 'number' ? p.age : null;
      if (age == null) {
        ageUnknown += 1;
        continue;
      }
      const idx = AGE_BANDS.findIndex((b) => age >= b.min && age <= b.max);
      if (idx === -1) {
        ageUnknown += 1;
        continue;
      }
      ageBands[idx].total += 1;
      if (p.gender === 'Male') ageBands[idx].Male += 1;
      else if (p.gender === 'Female') ageBands[idx].Female += 1;
    }

    // ---- Why members pause (self-reported at pause time) ----
    const pauseReasonCounts: Record<string, number> = {
      found_here: 0,
      found_elsewhere: 0,
      taking_break: 0,
      other: 0,
      prefer_not_say: 0,
    };
    let pauseFeedbackTotal = 0;
    const recentPauseNotes: { label: string; reason: string; note: string; created_at: string }[] = [];
    {
      const pauseRes = await fetchAllTableRows(admin, 'pause_feedback', 'profile_id, reason, note, created_at', 'created_at');
      if (pauseRes.error) {
        // Table may predate this deploy; analytics must not fail over an optional stat.
        console.error('analytics_stats: pause_feedback:', pauseRes.error);
      } else {
        const rows = pauseRes.rows as { profile_id: string | null; reason: string; note: string | null; created_at: string }[];
        pauseFeedbackTotal = rows.length;
        for (const r of rows) {
          if (r.reason in pauseReasonCounts) pauseReasonCounts[r.reason] += 1;
          if (r.note?.trim()) {
            recentPauseNotes.push({
              label: (r.profile_id ? labelById.get(r.profile_id) : null) ?? 'Removed member',
              reason: r.reason,
              note: r.note.trim(),
              created_at: r.created_at,
            });
          }
        }
        recentPauseNotes.sort((a, b) => b.created_at.localeCompare(a.created_at));
        recentPauseNotes.splice(10);
      }
    }

    // ---- Time series (Monday-start UTC weeks) ----
    const buckets = analyticsWeekBuckets(WEEKS);
    const registrationsByWeek = analyticsWeekSeries(profiles.map((p) => p.created_at), buckets);
    const requestsByWeek = analyticsWeekSeries(requestRows.map((r) => r.created_at), buckets);

    // ---- Most / least requested members ----
    const requestCountByProfile = new Map<string, number>();
    let candidateMentions = 0;
    for (const r of requestRows) {
      for (const c of r.candidate_ids ?? []) {
        if (!c) continue;
        candidateMentions += 1;
        requestCountByProfile.set(c, (requestCountByProfile.get(c) ?? 0) + 1);
      }
    }
    const statusById = new Map(profiles.map((p) => [p.id, p] as const));
    const topRequested = [...requestCountByProfile.entries()]
      .sort((a, b) => b[1] - a[1] || (labelById.get(a[0]) ?? '').localeCompare(labelById.get(b[0]) ?? ''))
      .slice(0, 10)
      .map(([profileId, count]) => {
        const prof = statusById.get(profileId);
        return {
          profile_id: profileId,
          label: labelById.get(profileId) ?? 'Unknown (removed member)',
          status: prof?.status ?? 'unknown',
          hidden_reason: prof?.hidden_reason ?? null,
          count,
        };
      });

    // Active, listed members nobody has requested yet -- the ones worth promoting.
    const zeroRequestedAll = profiles
      .filter((p) => p.status === 'active' && p.hidden_reason == null && !requestCountByProfile.has(p.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const zeroRequested = zeroRequestedAll.slice(0, 30).map((p) => ({
      profile_id: p.id,
      label: labelById.get(p.id) ?? 'Unknown',
      gender: p.gender,
      listed_since: p.created_at,
    }));

    // ---- Referral scheme ----
    const referralAgg = new Map<string, { count: number; rewarded: number; months: number }>();
    let referralMonthsAwarded = 0;
    let referralRewarded = 0;
    for (const r of referralRows) {
      const months = (r.referrer_months ?? 0) + (r.referred_months ?? 0);
      referralMonthsAwarded += months;
      if (r.rewarded_at != null) referralRewarded += 1;
      const agg = referralAgg.get(r.referrer_profile_id) ?? { count: 0, rewarded: 0, months: 0 };
      agg.count += 1;
      if (r.rewarded_at != null) agg.rewarded += 1;
      agg.months += r.referrer_months ?? 0;
      referralAgg.set(r.referrer_profile_id, agg);
    }
    const topReferrers = [...referralAgg.entries()]
      .sort((a, b) => b[1].count - a[1].count || (labelById.get(a[0]) ?? '').localeCompare(labelById.get(b[0]) ?? ''))
      .slice(0, 10)
      .map(([profileId, agg]) => ({
        profile_id: profileId,
        label: labelById.get(profileId) ?? 'Unknown (removed member)',
        referrals: agg.count,
        rewarded: agg.rewarded,
        months_earned: agg.months,
      }));

    return jsonResponse(
      {
        members: {
          total: profiles.length,
          byStatus,
          byHiddenReason,
          byGender,
          activeByGender,
          ageBands,
          ageUnknown,
        },
        pauses: {
          total: pauseFeedbackTotal,
          byReason: pauseReasonCounts,
          recent_notes: recentPauseNotes,
        },
        expiring: { in30: expiring30, in60: expiring60 },
        registrationsByWeek,
        requestsByWeek,
        requests: {
          total: requestRows.length,
          candidate_mentions: candidateMentions,
          top_requested: topRequested,
          zero_requested: zeroRequested,
          zero_requested_total: zeroRequestedAll.length,
        },
        referrals: {
          total: referralRows.length,
          rewarded: referralRewarded,
          months_awarded: referralMonthsAwarded,
          top_referrers: topReferrers,
        },
        feedback: {
          total: fbTotal.count ?? 0,
          recommend_yes: fbYes.count ?? 0,
          recommend_no: fbNo.count ?? 0,
          recommend_unsure: fbUnsure.count ?? 0,
          flagged_open: fbFlagged.count ?? 0,
          archived: fbArchived.count ?? 0,
        },
      },
      req
    );
  }

  // One-off catch-up for the 2 Aug 2026 incident: approvals and one registration
  // whose emails were lost when the mail library crashed the workers. Derives the
  // affected members from the data (never a hard-coded list) and skips anyone who
  // already has the email logged as sent, so it is safe to run more than once.
  if (action === 'temp_fix_incident_emails') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot send emails' }, req, 403);
    }
    if (!isTransactionalMailConfigured()) {
      return jsonResponse({ error: `Email is not configured. ${transactionalMailMissingReason()}` }, req, 500);
    }
    // Gmail blocked outbound mail from the evening of 2 Aug until the Brevo
    // switch on 4 Aug; the window runs to "now" so everything in between is
    // covered. email_log rows for blocked sends were flipped to 'failed'.
    const WINDOW_START = '2026-08-02T00:00:00Z';
    const WINDOW_END = new Date().toISOString();
    const results: { label: string; email_type: string; outcome: string }[] = [];

    const labelFor = async (profileId: string): Promise<string> => {
      const { data: p } = await admin
        .from('profiles')
        .select('first_name, reference_number')
        .eq('id', profileId)
        .maybeSingle();
      if (!p) return profileId.slice(0, 8);
      return memberDisplayLabel(p.first_name as string, null, p.reference_number as string | null) || profileId.slice(0, 8);
    };

    const hasSentEmail = async (profileId: string, emailType: string): Promise<boolean> => {
      const { count } = await admin
        .from('email_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_profile_id', profileId)
        .eq('email_type', emailType)
        .eq('status', 'sent');
      return (count ?? 0) > 0;
    };

    // 1. Members approved during the incident window with no "account active" email.
    const { data: acts, error: aErr } = await admin
      .from('admin_actions')
      .select('target_profile_id')
      .eq('action_type', 'approved')
      .gte('created_at', WINDOW_START)
      .lt('created_at', WINDOW_END);
    if (aErr) return jsonResponse({ error: aErr.message }, req, 500);
    const approvedIds = [
      ...new Set(
        (acts ?? [])
          .map((a) => (a as { target_profile_id: string | null }).target_profile_id)
          .filter((x): x is string => !!x)
      ),
    ];
    for (const pid of approvedIds) {
      const label = await labelFor(pid);
      if (await hasSentEmail(pid, 'registration_approved')) {
        results.push({ label, email_type: 'registration_approved', outcome: 'already sent - skipped' });
        continue;
      }
      const r = await dispatchEmail(admin, { type: 'registration_approved', recipientProfileId: pid });
      results.push({
        label,
        email_type: 'registration_approved',
        outcome: r.ok ? 'sent' : `failed: ${r.error ?? 'unknown'}`,
      });
    }

    // 1b. Members rejected during the window with no rejection email - they
    // don't know they need to fix and resubmit their application.
    const { data: rejActs, error: rjErr } = await admin
      .from('admin_actions')
      .select('target_profile_id')
      .eq('action_type', 'rejected')
      .gte('created_at', WINDOW_START)
      .lt('created_at', WINDOW_END);
    if (rjErr) return jsonResponse({ error: rjErr.message }, req, 500);
    const rejectedIds = [
      ...new Set(
        (rejActs ?? [])
          .map((a) => (a as { target_profile_id: string | null }).target_profile_id)
          .filter((x): x is string => !!x && !approvedIds.includes(x))
      ),
    ];
    for (const pid of rejectedIds) {
      const label = await labelFor(pid);
      if (await hasSentEmail(pid, 'registration_rejected')) {
        results.push({ label, email_type: 'registration_rejected', outcome: 'already sent - skipped' });
        continue;
      }
      const { data: profRow } = await admin
        .from('profiles')
        .select('rejection_reason, status')
        .eq('id', pid)
        .maybeSingle();
      if (!profRow || profRow.status !== 'rejected') {
        results.push({ label, email_type: 'registration_rejected', outcome: 'no longer rejected - skipped' });
        continue;
      }
      const r = await dispatchEmail(admin, {
        type: 'registration_rejected',
        recipientProfileId: pid,
        extra_data: { reason: (profRow.rejection_reason as string | null) ?? 'See your application for details.' },
      });
      results.push({
        label,
        email_type: 'registration_rejected',
        outcome: r.ok ? 'sent' : `failed: ${r.error ?? 'unknown'}`,
      });
    }

    // 1c. Older rejected members (before the window) who got their rejection
    // email but never resubmitted: one gentle "still open, fix and resubmit"
    // nudge. Skipped once a followup has ever been sent, so it never repeats.
    const { data: oldRejected, error: orErr } = await admin
      .from('profiles')
      .select('id, first_name')
      .eq('status', 'rejected');
    if (orErr) return jsonResponse({ error: orErr.message }, req, 500);
    for (const row of (oldRejected ?? []) as { id: string; first_name: string }[]) {
      if (rejectedIds.includes(row.id) || approvedIds.includes(row.id)) continue;
      const label = await labelFor(row.id);
      if (await hasSentEmail(row.id, 'rejection_followup')) {
        results.push({ label, email_type: 'rejection_followup', outcome: 'already sent - skipped' });
        continue;
      }
      const r = await dispatchEmail(admin, { type: 'rejection_followup', recipientProfileId: row.id });
      results.push({
        label,
        email_type: 'rejection_followup',
        outcome: r.ok ? 'sent' : `failed: ${r.error ?? 'unknown'}`,
      });
    }

    // 2. Applicants who registered in the window with no confirmation email.
    const { data: newProfs, error: npErr } = await admin
      .from('profiles')
      .select('id, first_name')
      .gte('created_at', WINDOW_START)
      .lt('created_at', WINDOW_END);
    if (npErr) return jsonResponse({ error: npErr.message }, req, 500);
    for (const row of (newProfs ?? []) as { id: string; first_name: string }[]) {
      if (await hasSentEmail(row.id, 'registration_received')) continue;
      const label = await labelFor(row.id);
      const r = await dispatchEmail(admin, {
        type: 'registration_received',
        recipientProfileId: row.id,
        extra_data: { first_name: row.first_name, resubmitted: false },
      });
      results.push({
        label,
        email_type: 'registration_received',
        outcome: r.ok ? 'sent' : `failed: ${r.error ?? 'unknown'}`,
      });
    }

    await admin.from('admin_actions').insert({
      admin_user_id: userData.user.id,
      target_profile_id: null,
      action_type: 'bulk_pending_reminder',
      notes: stripHtml(
        `Temp Fix Email (2 Aug incident catch-up): ${results.map((r) => `${r.label} ${r.email_type} ${r.outcome}`).join('; ')}`,
        2000
      ),
    });

    return jsonResponse({ results }, req);
  }

  if (action === 'update_member_record') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot edit member records' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);

    const profIn = body.profile as Record<string, unknown> | undefined;
    const privIn = body.member_private as Record<string, unknown> | undefined;
    if (!profIn && !privIn) {
      return jsonResponse({ error: 'Provide profile and/or member_private fields to update' }, req, 400);
    }

    const { data: profRow, error: profErr } = await admin
      .from('profiles')
      .select('id, auth_user_id')
      .eq('id', profileId)
      .single();
    if (profErr || !profRow) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const authUserId = profRow.auth_user_id as string;

    const { data: beforeProf } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: beforePriv } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();

    let previousMemberEmail = '';
    if (privIn && privIn.email !== undefined) {
      const { data: mp0 } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
      previousMemberEmail = (mp0?.email as string) ?? '';
    }

    if (privIn && privIn.email !== undefined) {
      const newEmail = stripHtml(String(privIn.email), 120);
      if (!newEmail) {
        return jsonResponse({ error: 'Email cannot be empty' }, req, 400);
      }
      if (newEmail !== previousMemberEmail) {
        const { error: aErr } = await admin.auth.admin.updateUserById(authUserId, { email: newEmail });
        if (aErr) {
          return jsonResponse({ error: `Could not update login email: ${aErr.message}` }, req, 400);
        }
      }
    }

    const profilePatch: Record<string, unknown> = {};
    if (profIn) {
      if (profIn.gender !== undefined) {
        const g = String(profIn.gender);
        if (g !== 'Male' && g !== 'Female') {
          return jsonResponse({ error: 'gender must be Male or Female' }, req, 400);
        }
        profilePatch.gender = g;
      }
      if (profIn.seeking_gender !== undefined) {
        const sg = String(profIn.seeking_gender);
        if (sg !== 'Male' && sg !== 'Female' && sg !== 'Both') {
          return jsonResponse({ error: 'seeking_gender must be Male, Female, or Both' }, req, 400);
        }
        profilePatch.seeking_gender = sg;
      }
      if (profIn.first_name !== undefined) {
        const fn = stripHtml(String(profIn.first_name), 80);
        if (!fn) return jsonResponse({ error: 'first_name cannot be empty' }, req, 400);
        profilePatch.first_name = fn;
      }
      if (profIn.education !== undefined) profilePatch.education = stripHtml(String(profIn.education), 500);
      if (profIn.job_title !== undefined) profilePatch.job_title = stripHtml(String(profIn.job_title), 200);
      if (profIn.nationality !== undefined) profilePatch.nationality = stripHtml(String(profIn.nationality), 100);
      if (profIn.place_of_birth !== undefined) {
        profilePatch.place_of_birth = stripHtml(String(profIn.place_of_birth), 200);
      }
      if (profIn.town_country_of_origin !== undefined) {
        profilePatch.town_country_of_origin = stripHtml(String(profIn.town_country_of_origin), 200);
      }
      if (profIn.future_settlement_plans !== undefined) {
        profilePatch.future_settlement_plans = stripHtml(String(profIn.future_settlement_plans), 200);
      }
      if (profIn.hobbies !== undefined) profilePatch.hobbies = stripHtml(String(profIn.hobbies), 400);

      if (profIn.height_cm !== undefined) {
        if (profIn.height_cm === null || profIn.height_cm === '') profilePatch.height_cm = null;
        else profilePatch.height_cm = Math.max(0, Math.floor(Number(profIn.height_cm)));
      }
      if (profIn.weight_kg !== undefined) {
        if (profIn.weight_kg === null || profIn.weight_kg === '') profilePatch.weight_kg = null;
        else profilePatch.weight_kg = Math.max(0, Math.floor(Number(profIn.weight_kg)));
      }

      if (profIn.diet !== undefined) {
        const d = String(profIn.diet);
        if (!['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'].includes(d)) {
          return jsonResponse({ error: 'Invalid diet' }, req, 400);
        }
        profilePatch.diet = d;
      }
      if (profIn.religion !== undefined) {
        const r = String(profIn.religion);
        if (!['Jain', 'Hindu', 'Other'].includes(r)) {
          return jsonResponse({ error: 'Invalid religion' }, req, 400);
        }
        profilePatch.religion = r;
      }
      if (profIn.community !== undefined) {
        if (profIn.community === null || profIn.community === '') {
          profilePatch.community = null;
        } else {
          const c = String(profIn.community);
          if (!['Vanik', 'Lohana', 'Brahmin', 'Other'].includes(c)) {
            return jsonResponse({ error: 'Invalid community' }, req, 400);
          }
          profilePatch.community = c;
        }
      }

      if (profIn.photo_url !== undefined) {
        profilePatch.photo_url = profIn.photo_url === null || profIn.photo_url === ''
          ? null
          : stripHtml(String(profIn.photo_url), 500);
      }
      if (profIn.pending_photo_url !== undefined) {
        profilePatch.pending_photo_url = profIn.pending_photo_url === null || profIn.pending_photo_url === ''
          ? null
          : stripHtml(String(profIn.pending_photo_url), 500);
      }
      if (profIn.photo_status !== undefined) {
        const ps = String(profIn.photo_status);
        if (!['pending', 'approved', 'rejected'].includes(ps)) {
          return jsonResponse({ error: 'Invalid photo_status' }, req, 400);
        }
        profilePatch.photo_status = ps;
      }

      if (profIn.status !== undefined) {
        const st = String(profIn.status);
        if (
          !['pending_approval', 'active', 'rejected', 'expired', 'closed'].includes(st)
        ) {
          return jsonResponse({ error: 'Invalid status' }, req, 400);
        }
        profilePatch.status = st;
      }

      if (profIn.hidden_reason !== undefined) {
        const hr = profIn.hidden_reason;
        if (hr !== null && !['member_paused', 'matched', 'admin'].includes(String(hr))) {
          return jsonResponse({ error: 'Invalid hidden_reason' }, req, 400);
        }
        profilePatch.hidden_reason = hr === null ? null : String(hr);
      }

      if (profIn.rejection_reason !== undefined) {
        profilePatch.rejection_reason =
          profIn.rejection_reason === null || profIn.rejection_reason === ''
            ? null
            : stripHtml(String(profIn.rejection_reason), 2000);
      }

      if (profIn.membership_expires_at !== undefined) {
        if (profIn.membership_expires_at === null || profIn.membership_expires_at === '') {
          profilePatch.membership_expires_at = null;
        } else {
          const d = new Date(String(profIn.membership_expires_at));
          if (Number.isNaN(d.getTime())) {
            return jsonResponse({ error: 'Invalid membership_expires_at' }, req, 400);
          }
          profilePatch.membership_expires_at = d.toISOString();
        }
      }
      if (profIn.last_request_at !== undefined) {
        if (profIn.last_request_at === null || profIn.last_request_at === '') {
          profilePatch.last_request_at = null;
        } else {
          const d = new Date(String(profIn.last_request_at));
          if (Number.isNaN(d.getTime())) {
            return jsonResponse({ error: 'Invalid last_request_at' }, req, 400);
          }
          profilePatch.last_request_at = d.toISOString();
        }
      }
    }

    if (profilePatch.status === 'pending_approval') {
      profilePatch.rejection_reason = null;
    }

    const privatePatch: Record<string, unknown> = {};
    if (privIn) {
      if (privIn.surname !== undefined) {
        const sn = stripHtml(String(privIn.surname), 80);
        if (!sn) return jsonResponse({ error: 'surname cannot be empty' }, req, 400);
        privatePatch.surname = sn;
      }
      if (privIn.date_of_birth !== undefined) {
        const dob = String(privIn.date_of_birth).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          return jsonResponse({ error: 'date_of_birth must be YYYY-MM-DD' }, req, 400);
        }
        privatePatch.date_of_birth = dob;
      }
      if (privIn.email !== undefined) privatePatch.email = stripHtml(String(privIn.email), 120);
      if (privIn.mobile_phone !== undefined) {
        privatePatch.mobile_phone = stripHtml(String(privIn.mobile_phone), 40);
      }
      if (privIn.home_address_line1 !== undefined) {
        privatePatch.home_address_line1 = stripHtml(String(privIn.home_address_line1), 200);
      }
      if (privIn.home_address_city !== undefined) {
        privatePatch.home_address_city = stripHtml(String(privIn.home_address_city), 100);
      }
      if (privIn.home_address_postcode !== undefined) {
        privatePatch.home_address_postcode = stripHtml(String(privIn.home_address_postcode), 20);
      }
      if (privIn.home_address_country !== undefined) {
        privatePatch.home_address_country = stripHtml(String(privIn.home_address_country), 80);
      }
      if (privIn.father_name !== undefined) {
        privatePatch.father_name = stripHtml(String(privIn.father_name), 120);
      }
      if (privIn.mother_name !== undefined) {
        privatePatch.mother_name = stripHtml(String(privIn.mother_name), 120);
      }
      if (privIn.id_document_url !== undefined) {
        privatePatch.id_document_url =
          privIn.id_document_url === null || privIn.id_document_url === ''
            ? null
            : stripHtml(String(privIn.id_document_url), 500);
      }
      if (privIn.coupon_used !== undefined) {
        if (privIn.coupon_used === null || privIn.coupon_used === '') {
          privatePatch.coupon_used = null;
        } else {
          const code = stripHtml(String(privIn.coupon_used), 32).toUpperCase();
          const { data: cRow } = await admin.from('coupons').select('code').eq('code', code).maybeSingle();
          if (!cRow) return jsonResponse({ error: `Unknown coupon code: ${code}` }, req, 400);
          privatePatch.coupon_used = code;
        }
      }
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error: u1 } = await admin.from('profiles').update(profilePatch).eq('id', profileId);
      if (u1) return jsonResponse({ error: u1.message }, req, 500);
    }
    if (Object.keys(privatePatch).length > 0) {
      const { error: u2 } = await admin.from('member_private').update(privatePatch).eq('profile_id', profileId);
      if (u2) return jsonResponse({ error: u2.message }, req, 500);
    }

    const { data: afterProf } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: afterPriv } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();

    const diffLines: string[] = [];
    const bProf = (beforeProf ?? {}) as Record<string, unknown>;
    const aProf = (afterProf ?? {}) as Record<string, unknown>;
    const bPriv = (beforePriv ?? {}) as Record<string, unknown>;
    const aPriv = (afterPriv ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(profilePatch)) {
      const prev = JSON.stringify(bProf[k]);
      const next = JSON.stringify(aProf[k]);
      if (prev !== next) diffLines.push(`profiles.${k}: ${prev} → ${next}`);
    }
    for (const k of Object.keys(privatePatch)) {
      const prev = JSON.stringify(bPriv[k]);
      const next = JSON.stringify(aPriv[k]);
      if (prev !== next) diffLines.push(`member_private.${k}: ${prev} → ${next}`);
    }
    const changeSummary = diffLines.join('\n').slice(0, 24000);

    const editNote = stripHtml(String(body.edit_note ?? ''), 500);
    const notesParts = [editNote || 'Record updated by admin'];
    if (changeSummary) notesParts.push('Changes:\n' + changeSummary);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'profile_admin_edit',
      notes: notesParts.join('\n\n').slice(0, 30000),
    });

    return jsonResponse({ ok: true }, req);
  }

  if (action === 'set_contact_request_bonuses') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot change contact request bonuses' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const parseBonus = (v: unknown): number | null => {
      if (v === undefined || v === null || v === '') return 0;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > CONTACT_QUOTA_BONUS_MAX) return null;
      return n;
    };
    const wB = parseBonus(body.contact_request_weekly_bonus);
    const mB = parseBonus(body.contact_request_monthly_bonus);
    if (wB === null || mB === null) {
      return jsonResponse({ error: `Bonuses must be integers 0-${CONTACT_QUOTA_BONUS_MAX}` }, req, 400);
    }
    const { data: beforeRow, error: be } = await admin
      .from('member_private')
      .select('contact_request_weekly_bonus, contact_request_monthly_bonus')
      .eq('profile_id', profileId)
      .single();
    if (be || !beforeRow) return jsonResponse({ error: 'Member not found' }, req, 404);
    const before = beforeRow as {
      contact_request_weekly_bonus: number | null;
      contact_request_monthly_bonus: number | null;
    };
    const { error: upErr } = await admin
      .from('member_private')
      .update({
        contact_request_weekly_bonus: wB,
        contact_request_monthly_bonus: mB,
      })
      .eq('profile_id', profileId);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    const prevW = Number(before.contact_request_weekly_bonus ?? 0);
    const prevM = Number(before.contact_request_monthly_bonus ?? 0);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'contact_request_quota_adjusted',
      notes: `Extra 7-day slots: ${prevW} → ${wB}. Extra calendar-month slots: ${prevM} → ${mB}.`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'extend_membership') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot extend memberships' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const months = Math.floor(Number(body.months));
    if (!Number.isFinite(months) || months < 1 || months > 24) {
      return jsonResponse({ error: 'months must be an integer between 1 and 24' }, req, 400);
    }
    const { data: profRow, error: pErr } = await admin
      .from('profiles')
      .select('id, status, membership_expires_at')
      .eq('id', profileId)
      .single();
    if (pErr || !profRow) return jsonResponse({ error: 'Member not found' }, req, 404);
    const prof = profRow as { id: string; status: string; membership_expires_at: string | null };
    if (prof.status !== 'active' && prof.status !== 'expired') {
      return jsonResponse(
        { error: `Cannot extend membership while status is '${prof.status}'. Approve or reopen the account first.` },
        req,
        400
      );
    }
    // Extend from the current expiry if it is still in the future, otherwise from now
    // (an already-lapsed member gets the full N months from today, not from the past).
    const now = new Date();
    const currentExpiry = prof.membership_expires_at ? new Date(prof.membership_expires_at) : null;
    const base =
      currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > now.getTime()
        ? currentExpiry
        : now;
    const target = new Date(base.getTime());
    const dayOfMonth = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + months);
    const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));
    const newExpiryIso = target.toISOString();
    const reactivated = prof.status === 'expired';
    const update: Record<string, unknown> = { membership_expires_at: newExpiryIso };
    if (reactivated) update.status = 'active';
    const { error: upErr } = await admin.from('profiles').update(update).eq('id', profileId);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'none');
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'membership_extended',
      notes: `Added ${months} free month${months === 1 ? '' : 's'}: expiry ${fmt(currentExpiry)} → ${fmt(target)}${
        reactivated ? '. Status expired → active.' : '.'
      }`,
    });
    return jsonResponse({ ok: true, membership_expires_at: newExpiryIso, reactivated }, req);
  }

  if (action === 'get_member_detail') {
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);

    const { data: profile, error: pErr } = await admin.from('profiles').select('*').eq('id', profileId).single();
    if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
    const { data: memberPrivateColumns, error: mErr } = await admin
      .from('member_private')
      .select('*')
      .eq('profile_id', profileId)
      .single();
    if (mErr) return jsonResponse({ error: mErr.message }, req, 500);
    const memberPrivate = memberPrivateColumns;

    const prof = profile as {
      photo_url: string | null;
      photo_paths?: string[] | null;
      pending_photo_url: string | null;
    };
    const priv = memberPrivate as { id_document_url: string | null };

    const signedUrls: {
      photo: string | null;
      photos: string[];
      pending_photo: string | null;
      id_document: string | null;
    } = {
      photo: null,
      photos: [],
      pending_photo: null,
      id_document: null,
    };
    // Preferred source: the multi-photo gallery (has ids, so the UI can offer per-photo removal).
    const { data: galleryRows } = await admin
      .from('profile_photos')
      .select('id, storage_path, position, is_primary')
      .eq('profile_id', profileId)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true });
    const photoGallery: Array<{ id: string; position: number; is_primary: boolean; signed_url: string | null }> = [];
    for (const row of (galleryRows ?? []) as { id: string; storage_path: string; position: number; is_primary: boolean }[]) {
      const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(row.storage_path, 3600);
      photoGallery.push({
        id: row.id,
        position: row.position,
        is_primary: row.is_primary,
        signed_url: s?.signedUrl ?? null,
      });
    }
    if (photoGallery.length > 0) {
      signedUrls.photos = photoGallery
        .map((g) => g.signed_url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
    } else {
      // Legacy fallback for profiles predating the profile_photos table.
      const photoPaths = Array.isArray(prof.photo_paths)
        ? prof.photo_paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : [];
      const uniquePaths = [...new Set(photoPaths)];
      const effectivePhotoPaths = uniquePaths.length > 0 ? uniquePaths : (prof.photo_url ? [prof.photo_url] : []);
      for (const path of effectivePhotoPaths) {
        const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(path, 3600);
        const signed = s?.signedUrl ?? null;
        if (signed) signedUrls.photos.push(signed);
      }
    }
    signedUrls.photo = signedUrls.photos[0] ?? null;
    if (prof.pending_photo_url) {
      const { data: s } = await admin.storage.from('profile-photos').createSignedUrl(prof.pending_photo_url, 900);
      signedUrls.pending_photo = s?.signedUrl ?? null;
    }
    if (priv.id_document_url) {
      const { data: s } = await admin.storage.from('id-documents').createSignedUrl(priv.id_document_url, 3600);
      signedUrls.id_document = s?.signedUrl ?? null;
    }

    const { data: actions, error: aErr } = await admin
      .from('admin_actions')
      .select('id, action_type, notes, created_at, admin_user_id')
      .eq('target_profile_id', profileId)
      .order('created_at', { ascending: false });
    if (aErr) return jsonResponse({ error: aErr.message }, req, 500);

    const adminIds = [
      ...new Set(
        (actions ?? [])
          .map((a: { admin_user_id: string | null }) => a.admin_user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const emailByUserId: Record<string, string | null> = {};
    for (const uid of adminIds) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      emailByUserId[uid] = u.user?.email ?? null;
    }

    const timeline = (actions ?? []).map(
      (a: { id: string; action_type: string; notes: string | null; created_at: string; admin_user_id: string | null }) => ({
        id: a.id,
        action_type: a.action_type,
        notes: a.notes,
        created_at: a.created_at,
        admin_email: a.admin_user_id ? emailByUserId[a.admin_user_id] ?? null : null,
      })
    );

    const { data: noteRow } = await admin
      .from('admin_profile_notes')
      .select('body, updated_at, updated_by')
      .eq('profile_id', profileId)
      .maybeSingle();

    const { data: recentEmails } = await admin
      .from('email_log')
      .select('id, email_type, subject, sent_at, status')
      .eq('recipient_profile_id', profileId)
      .order('sent_at', { ascending: false })
      .limit(10);

    const { data: reqRows, error: rqErr } = await admin
      .from('requests')
      .select('created_at, candidate_ids')
      .eq('requester_id', profileId)
      .order('created_at', { ascending: false })
      .limit(800);
    if (rqErr) return jsonResponse({ error: rqErr.message }, req, 500);

    const { data: pauseRows } = await admin
      .from('pause_feedback')
      .select('reason, note, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(10);
    const mpQuota = memberPrivate as {
      contact_request_weekly_bonus?: number | null;
      contact_request_monthly_bonus?: number | null;
    };
    const contact_request_quota = contactQuotaFromRequests(
      (reqRows ?? []) as { created_at: string; candidate_ids: string[] | null }[],
      Number(mpQuota.contact_request_weekly_bonus ?? 0),
      Number(mpQuota.contact_request_monthly_bonus ?? 0)
    );

    return jsonResponse({
      profile,
      member_private: memberPrivate,
      signed_urls: signedUrls,
      photo_gallery: photoGallery,
      timeline,
      admin_note: noteRow ?? { body: '', updated_at: null, updated_by: null },
      recent_emails: recentEmails ?? [],
      contact_request_quota,
      pause_feedback: pauseRows ?? [],
    }, req);
  }

  // Signal for the admin banner: UNRESOLVED failures in the last 48 hours.
  // A failure followed by a later successful send of the same email type to
  // the same recipient (e.g. via Temp Fix or the Resend button) is resolved
  // and no longer counts - the banner should clear once the admin has acted.
  if (action === 'email_health') {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: rows, error: ehErr } = await admin
      .from('email_log')
      .select('recipient_email, email_type, status, sent_at')
      .gte('sent_at', cutoff)
      .order('sent_at', { ascending: true })
      .limit(2000);
    if (ehErr) return jsonResponse({ error: ehErr.message }, req, 500);
    const all = (rows ?? []) as { recipient_email: string | null; email_type: string; status: string; sent_at: string }[];
    const okStatuses = new Set(['sent', 'delivered']);
    const resolvedLater = (p: (typeof all)[number]) =>
      all.some(
        (r) =>
          r.recipient_email === p.recipient_email &&
          r.email_type === p.email_type &&
          okStatuses.has(r.status) &&
          r.sent_at > p.sent_at
      );
    let failedCount = 0;
    let undeliveredCount = 0;
    for (const r of all) {
      if (r.status === 'failed' && !resolvedLater(r)) failedCount += 1;
      else if (['bounced', 'blocked', 'spam'].includes(r.status) && !resolvedLater(r)) undeliveredCount += 1;
    }
    return jsonResponse({ failed: failedCount, undelivered: undeliveredCount }, req);
  }

  // Cheap head-count for the pending badge shown on the admin nav and Members page.
  if (action === 'pending_count') {
    const { count, error: pcErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval');
    if (pcErr) return jsonResponse({ error: pcErr.message }, req, 500);
    return jsonResponse({ pending: count ?? 0 }, req);
  }

  if (action === 'list_email_log') {
    const limit =
      typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 1000 ? Math.floor(body.limit) : 300;
    const { data, error } = await admin
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    return jsonResponse({ rows: data ?? [] }, req);
  }

  if (action === 'list_client_errors') {
    const limit =
      typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 1000 ? Math.floor(body.limit) : 200;
    const search = typeof body.search === 'string' ? body.search.trim() : '';
    let q = admin
      .from('client_error_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (search) {
      const like = `%${search.replace(/[%_,()]/g, '')}%`;
      q = q.or(`error_code.ilike.${like},user_email.ilike.${like},area.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error) return jsonResponse({ error: error.message }, req, 500);
    return jsonResponse({ rows: data ?? [] }, req);
  }

  if (action === 'list_cron_runs') {
    const jobNames = Array.isArray(body.job_names)
      ? body.job_names.filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    if (jobNames.length === 0) return jsonResponse({ error: 'job_names required' }, req, 400);
    const limit =
      typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 500 ? Math.floor(body.limit) : 100;
    const { data, error } = await admin
      .from('cron_job_runs')
      .select('*')
      .in('job_name', jobNames)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, req, 500);
    return jsonResponse({ runs: data ?? [] }, req);
  }

  /** Trigger a cron edge function using CRON_SECRET (browser cannot safely send x-cron-secret). */
  if (action === 'run_cron_job') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot run cron jobs' }, req, 403);
    }
    const allowed = new Set([
      'send-feedback-reminders',
      'send-renewal-reminders',
      'send-account-freeze-reminders',
      'send-inactivity-nudges',
      'expire-memberships',
      'archive-lapsed-members',
      'purge-archived-accounts',
    ]);
    const jobName = typeof body.job_name === 'string' ? body.job_name.trim() : '';
    if (!jobName || !allowed.has(jobName)) {
      return jsonResponse({ error: 'Invalid job_name' }, req, 400);
    }
    const cronSecret = Deno.env.get('CRON_SECRET')?.trim();
    if (!cronSecret) {
      return jsonResponse(
        {
          error: 'Forbidden',
          message: 'Set CRON_SECRET in Edge Function secrets and send header x-cron-secret.',
        },
        req,
        403
      );
    }
    const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${encodeURIComponent(jobName)}`;
    let invokeRes: Response;
    try {
      invokeRes = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anon}`,
          apikey: anon,
          'x-cron-secret': cronSecret,
        },
        body: '{}',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: `Cron invoke failed: ${msg}` }, req, 502);
    }
    const text = await invokeRes.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: 'Invalid JSON from cron function', raw: text.slice(0, 500) };
    }
    if (!invokeRes.ok) {
      const payload =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { error: text || invokeRes.statusText };
      return jsonResponse(payload, req, invokeRes.status);
    }
    const out =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { result: parsed };
    return jsonResponse(out, req);
  }

  if (action === 'coupons_data') {
    const { data: coupons, error: cErr } = await admin
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (cErr) return jsonResponse({ error: cErr.message }, req, 500);

    const { data: usageRows, error: uErr } = await admin
      .from('member_private')
      .select('profile_id, coupon_used')
      .not('coupon_used', 'is', null)
      .order('profile_id');
    if (uErr) return jsonResponse({ error: uErr.message }, req, 500);

    const usage = usageRows ?? [];
    const profileIds = [...new Set((usage as { profile_id: string }[]).map((r) => r.profile_id))];
    const profilesById: Record<
      string,
      { first_name: string; reference_number: string | null; created_at: string }
    > = {};
    if (profileIds.length > 0) {
      const { data: profs, error: pErr } = await admin
        .from('profiles')
        .select('id, first_name, reference_number, created_at')
        .in('id', profileIds);
      if (pErr) return jsonResponse({ error: pErr.message }, req, 500);
      for (const p of profs ?? []) {
        const row = p as {
          id: string;
          first_name: string;
          reference_number: string | null;
          created_at: string;
        };
        profilesById[row.id] = {
          first_name: row.first_name,
          reference_number: row.reference_number,
          created_at: row.created_at,
        };
      }
    }

    const usageWithProfiles = (usage as { profile_id: string; coupon_used: string }[]).map((r) => ({
      profile_id: r.profile_id,
      coupon_used: r.coupon_used,
      profiles: profilesById[r.profile_id] ?? null,
    }));

    return jsonResponse({ coupons: coupons ?? [], usage: usageWithProfiles }, req);
  }

  if (action === 'create_coupon') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot create coupons' }, req, 403);
    }
    const codeRaw = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!codeRaw) return jsonResponse({ error: 'code required' }, req, 400);
    if (!/^[A-Z0-9]{1,32}$/.test(codeRaw)) {
      return jsonResponse(
        { error: 'Coupon code must be letters and numbers only (A-Z, 0-9), up to 32 characters' },
        req,
        400
      );
    }
    const type = body.type === 'discount_percent' ? 'discount_percent' : 'free';
    let discountPercent: number | null = null;
    if (type === 'discount_percent') {
      const n = Number(body.discount_percent);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return jsonResponse({ error: 'discount_percent must be 1-100' }, req, 400);
      }
      discountPercent = n;
    }
    const maxUses =
      body.max_uses != null && body.max_uses !== ''
        ? Math.floor(Number(body.max_uses))
        : null;
    if (maxUses != null && (!Number.isFinite(maxUses) || maxUses < 1)) {
      return jsonResponse({ error: 'max_uses invalid' }, req, 400);
    }
    let freeMonths: number | null = null;
    if (body.free_months != null && body.free_months !== '') {
      const n = Math.floor(Number(body.free_months));
      if (!Number.isFinite(n) || n < 1 || n > 36) {
        return jsonResponse({ error: 'free_months must be 1-36' }, req, 400);
      }
      if (type !== 'free') {
        return jsonResponse({ error: 'free_months only applies to free coupons' }, req, 400);
      }
      freeMonths = n;
    }
    const expiresAt =
      typeof body.expires_at === 'string' && body.expires_at.trim()
        ? new Date(body.expires_at).toISOString()
        : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const { error: insErr } = await admin.from('coupons').insert({
      code: codeRaw,
      type,
      discount_percent: discountPercent,
      max_uses: maxUses,
      free_months: freeMonths,
      expires_at: expiresAt,
      notes,
      is_active: true,
      created_by: callerId,
    });
    if (insErr) {
      if (insErr.code === '23505') {
        return jsonResponse(
          { error: `A coupon with the code ${codeRaw} already exists. It may already be in the table below.` },
          req,
          409
        );
      }
      return jsonResponse({ error: insErr.message }, req, 500);
    }
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'revoke_coupon') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot revoke coupons' }, req, 403);
    }
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) return jsonResponse({ error: 'code required' }, req, 400);
    const { error: upErr } = await admin.from('coupons').update({ is_active: false }).eq('code', code);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'update_coupon') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot update coupons' }, req, 403);
    }
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) return jsonResponse({ error: 'code required' }, req, 400);
    const { data: existing, error: exErr } = await admin
      .from('coupons')
      .select('code, type')
      .eq('code', code)
      .maybeSingle();
    if (exErr) return jsonResponse({ error: exErr.message }, req, 500);
    if (!existing) return jsonResponse({ error: 'Coupon not found' }, req, 404);

    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    if (typeof body.is_active === 'boolean') {
      patch.is_active = body.is_active;
      changes.push(body.is_active ? 'resumed' : 'paused');
    }
    if ('free_months' in body) {
      if (body.free_months === null || body.free_months === '') {
        patch.free_months = null;
        changes.push('free access reset to standard 12 months');
      } else {
        const n = Math.floor(Number(body.free_months));
        if (!Number.isFinite(n) || n < 1 || n > 36) {
          return jsonResponse({ error: 'free_months must be 1-36' }, req, 400);
        }
        if (existing.type !== 'free') {
          return jsonResponse({ error: 'free_months only applies to free coupons' }, req, 400);
        }
        patch.free_months = n;
        changes.push(`free access set to ${n} months`);
      }
    }
    if ('expires_at' in body) {
      if (body.expires_at === null || body.expires_at === '') {
        patch.expires_at = null;
        changes.push('expiry cleared');
      } else if (typeof body.expires_at === 'string') {
        const d = new Date(body.expires_at);
        if (Number.isNaN(d.getTime())) {
          return jsonResponse({ error: 'expires_at invalid' }, req, 400);
        }
        patch.expires_at = d.toISOString();
        changes.push(`expiry set to ${d.toISOString()}`);
      } else {
        return jsonResponse({ error: 'expires_at invalid' }, req, 400);
      }
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ error: 'No changes provided' }, req, 400);
    }
    const { error: upErr } = await admin.from('coupons').update(patch).eq('code', code);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      action_type: 'coupon_updated',
      notes: `Coupon ${code}: ${changes.join(', ')}`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'set_admin_role') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const targetId = typeof body.user_id === 'string' ? body.user_id : '';
    const role = body.role === 'support' ? 'support' : body.role === 'super' ? 'super' : '';
    if (!targetId || !role) {
      return jsonResponse({ error: 'user_id and role (super|support) required' }, req, 400);
    }
    const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
    if (gErr || !target.user) {
      return jsonResponse({ error: 'User not found' }, req, 404);
    }
    const am0 = target.user.app_metadata as Record<string, unknown> | undefined;
    if (!metaIsAdminFlag(am0?.is_admin)) {
      return jsonResponse({ error: 'Target is not an admin' }, req, 400);
    }
    const am = { ...am0, is_admin: true, admin_role: role };
    const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: am });
    if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'admin_role_changed',
      notes: `user_id=${targetId} role=${role}`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'set_internal_note') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot edit internal notes' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const noteBody = stripHtml(String(body.note ?? ''), 20000);
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { error: nErr } = await admin.from('admin_profile_notes').upsert(
      {
        profile_id: profileId,
        body: noteBody,
        updated_at: new Date().toISOString(),
        updated_by: callerId,
      },
      { onConflict: 'profile_id' }
    );
    if (nErr) return jsonResponse({ error: nErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'internal_note_updated',
      notes: 'Staff internal note saved',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'purge_id_document') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: privRow, error: pe } = await admin
      .from('member_private')
      .select('id_document_url')
      .eq('profile_id', profileId)
      .single();
    if (pe || !privRow) return jsonResponse({ error: 'Member not found' }, req, 404);
    const path = privRow.id_document_url as string | null;
    if (path) {
      const { error: rmErr } = await admin.storage.from('id-documents').remove([path]);
      if (rmErr) return jsonResponse({ error: rmErr.message }, req, 500);
    }
    const { error: upErr } = await admin
      .from('member_private')
      .update({ id_document_url: null, id_document_deleted_at: new Date().toISOString() })
      .eq('profile_id', profileId);
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'id_document_purged',
      notes: path ? `Removed storage object` : 'No file on record',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'resend_member_email') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot resend member emails' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const template = typeof body.template === 'string' ? body.template : '';
    const allowed = new Set([
      'admin_pending_reminder',
      'registration_received',
      'registration_approved',
      'registration_rejected',
      'renewal_reminder',
      'membership_expired',
    ]);
    if (!profileId || !allowed.has(template)) {
      return jsonResponse({ error: 'profile_id and valid template required' }, req, 400);
    }
    if (!isTransactionalMailConfigured()) {
      return jsonResponse(
        { error: `Email provider not configured. ${transactionalMailMissingReason()}` },
        req,
        500
      );
    }

    const { data: profT } = await admin.from('profiles').select('*').eq('id', profileId).single();
    const { data: memT } = await admin.from('member_private').select('*').eq('profile_id', profileId).single();
    if (!profT || !memT) return jsonResponse({ error: 'Profile not found' }, req, 404);

    const extra: Record<string, unknown> = {};
    if (template === 'registration_received') {
      extra.first_name = profT.first_name;
      extra.resubmitted = body.resubmitted === true;
    }
    if (template === 'registration_rejected') {
      extra.reason = profT.rejection_reason ?? 'Please see previous correspondence.';
    }
    if (template === 'renewal_reminder') {
      extra.days = typeof body.days === 'number' ? Math.min(90, Math.max(1, body.days)) : 30;
    }

    const r = await dispatchEmail(admin, {
      type: template as EmailType,
      recipientProfileId: profileId,
      extraData: extra,
    });
    if (!r.ok) return jsonResponse({ error: r.error ?? 'Send failed' }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'email_resent',
      notes: `template=${template}`,
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'send_pending_reminders') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot send reminders' }, req, 403);
    }
    const ids = Array.isArray(body.profile_ids) ? body.profile_ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0 || ids.length > 40) {
      return jsonResponse({ error: 'profile_ids array required (max 40)' }, req, 400);
    }
    if (!isTransactionalMailConfigured()) {
      return jsonResponse(
        { error: `Email provider not configured. ${transactionalMailMissingReason()}` },
        req,
        500
      );
    }
    let sent = 0;
    const skipped: string[] = [];
    for (const pid of ids) {
      const { data: p } = await admin.from('profiles').select('status').eq('id', pid).single();
      if (p?.status !== 'pending_approval') {
        skipped.push(pid);
        continue;
      }
      const r = await dispatchEmail(admin, {
        type: 'admin_pending_reminder',
        recipientProfileId: pid,
      });
      if (r.ok) sent++;
    }
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: null,
      action_type: 'bulk_pending_reminder',
      notes: `sent=${sent} skipped=${skipped.length}`,
    });
    return jsonResponse({ ok: true, sent, skipped }, req);
  }

  if (action === 'generate_member_magic_link') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: memE } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
    const email = memE?.email as string | undefined;
    if (!email) return jsonResponse({ error: 'No email for profile' }, req, 400);
    const redirectTo = `${publicSiteBaseUrl()}/dashboard/browse`;
    const { data: linkData, error: le } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (le || !linkData?.properties?.action_link) {
      return jsonResponse({ error: le?.message ?? 'Could not generate link' }, req, 500);
    }
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'impersonation_magic_link',
      notes: 'One-time magic link generated (not stored)',
    });
    return jsonResponse({ action_link: linkData.properties.action_link }, req);
  }

  if (action === 'revoke_member_sessions') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: prow } = await admin.from('profiles').select('auth_user_id').eq('id', profileId).single();
    const uid = prow?.auth_user_id as string | undefined;
    if (!uid) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const { error: banErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: '2s' });
    if (banErr) return jsonResponse({ error: banErr.message }, req, 500);
    await new Promise((r) => setTimeout(r, 2100));
    const { error: unbanErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' });
    if (unbanErr) return jsonResponse({ error: unbanErr.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'sessions_revoked',
      notes: 'Brief account lock to invalidate refresh tokens',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'send_password_recovery_for_member') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Super admin only' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    if (!profileId) return jsonResponse({ error: 'profile_id required' }, req, 400);
    const { data: memE } = await admin.from('member_private').select('email').eq('profile_id', profileId).single();
    const email = memE?.email as string | undefined;
    if (!email) return jsonResponse({ error: 'No email for profile' }, req, 400);
    const redirectTo = `${publicSiteBaseUrl()}/login`;
    const { error: re } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });
    if (re) return jsonResponse({ error: re.message }, req, 500);
    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'password_recovery_sent',
      notes: 'Recovery email triggered via admin',
    });
    return jsonResponse({ ok: true }, req);
  }

  if (action === 'admin_upload_member_photo') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot upload member photos' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const rawB64 = typeof body.image_base64 === 'string' ? body.image_base64.trim() : '';
    const mode = body.mode === 'pending_review' ? 'pending_review' : 'direct';
    if (!profileId || !rawB64) {
      return jsonResponse({ error: 'profile_id and image_base64 required' }, req, 400);
    }

    let b64 = rawB64.replace(/\s/g, '');
    const dataUrl = /^data:image\/(?:jpeg|jpg|png);base64,(.+)$/i.exec(b64);
    if (dataUrl) b64 = dataUrl[1];

    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      if (bin.length < 200 || bin.length > 2_500_000) {
        return jsonResponse({ error: 'Image size must be between 200 bytes and 2.5MB' }, req, 400);
      }
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return jsonResponse({ error: 'Invalid base64 image' }, req, 400);
    }

    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isJpeg && !isPng) {
      return jsonResponse({ error: 'Image must be JPEG or PNG (by file content)' }, req, 400);
    }
    const contentType = isJpeg ? 'image/jpeg' : 'image/png';
    const ext = isJpeg ? 'jpg' : 'png';

    const { data: prof, error: pe } = await admin
      .from('profiles')
      .select('id, gender, auth_user_id, photo_url, pending_photo_url')
      .eq('id', profileId)
      .single();
    if (pe || !prof) return jsonResponse({ error: 'Profile not found' }, req, 404);
    const gender = String(prof.gender);
    if (gender !== 'Male' && gender !== 'Female') {
      return jsonResponse({ error: 'Invalid profile gender' }, req, 400);
    }
    const authUid = prof.auth_user_id as string;
    const baseFolder = `${gender}/${authUid}`;
    // Pending files get a unique name so a re-upload or reject can never
    // overwrite/delete an object a previous approval promoted into the gallery.
    const objectPath =
      mode === 'pending_review'
        ? `${baseFolder}/photo-pending-${Date.now()}.${ext}`
        : `${baseFolder}/photo.${ext}`;

    const { error: upErr } = await admin.storage.from('profile-photos').upload(objectPath, bytes, {
      upsert: true,
      contentType,
    });
    if (upErr) return jsonResponse({ error: upErr.message }, req, 500);

    const oldMain = prof.photo_url as string | null;
    const oldPending = prof.pending_photo_url as string | null;

    if (mode === 'direct') {
      // Replace the primary row in profile_photos too - serve-photo and the member
      // gallery read that table first, so updating profiles.photo_url alone would
      // leave the new image invisible (and the primary row pointing at a deleted file).
      const { referenced, error: galErr } = await replacePrimaryGalleryPhoto(admin, profileId, objectPath);
      if (galErr) return jsonResponse({ error: galErr }, req, 500);
      const stillReferenced = new Set(referenced);
      const removable = [...new Set([oldMain, oldPending])].filter(
        (p): p is string => !!p && p !== objectPath && !stillReferenced.has(p)
      );
      if (removable.length > 0) {
        const { error: rmErr } = await admin.storage.from('profile-photos').remove(removable);
        if (rmErr) console.warn('admin_upload_member_photo remove replaced objects:', rmErr.message);
      }
      const { error: dbErr } = await admin
        .from('profiles')
        .update({
          photo_url: objectPath,
          pending_photo_url: null,
          photo_status: 'approved',
        })
        .eq('id', profileId);
      if (dbErr) return jsonResponse({ error: dbErr.message }, req, 500);
    } else {
      if (oldPending && oldPending !== objectPath) {
        const { error: rmErr } = await admin.storage.from('profile-photos').remove([oldPending]);
        if (rmErr) console.warn('admin_upload_member_photo remove old pending:', rmErr.message);
      }
      const { error: dbErr } = await admin
        .from('profiles')
        .update({
          pending_photo_url: objectPath,
          photo_status: 'pending',
        })
        .eq('id', profileId);
      if (dbErr) return jsonResponse({ error: dbErr.message }, req, 500);
    }

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'photo_admin_upload',
      notes: mode === 'direct' ? `direct path=${objectPath}` : `pending_review path=${objectPath}`,
    });

    return jsonResponse({ ok: true, path: objectPath, mode }, req);
  }

  if (action === 'admin_remove_member_photo') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot remove member photos' }, req, 403);
    }
    const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
    const photoId = typeof body.photo_id === 'string' ? body.photo_id : '';
    const reason = stripHtml(String(body.reason ?? ''), 500).trim();
    if (!profileId || !photoId) {
      return jsonResponse({ error: 'profile_id and photo_id required' }, req, 400);
    }
    if (!reason) {
      return jsonResponse({ error: 'A reason is required; it is emailed to the member.' }, req, 400);
    }

    const { data: photoRow, error: phErr } = await admin
      .from('profile_photos')
      .select('id, profile_id, storage_path')
      .eq('id', photoId)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (phErr) return jsonResponse({ error: phErr.message }, req, 500);
    if (!photoRow) return jsonResponse({ error: 'Photo not found on this profile' }, req, 404);

    const { error: delErr } = await admin
      .from('profile_photos')
      .delete()
      .eq('id', photoId)
      .eq('profile_id', profileId);
    if (delErr) return jsonResponse({ error: delErr.message }, req, 500);
    await admin.storage.from('profile-photos').remove([photoRow.storage_path as string]).catch(() => null);

    // Re-pack positions, keep exactly one primary, and sync profiles.photo_url
    // (same invariants member-manage-photos maintains).
    const { data: remainRows, error: remErr } = await admin
      .from('profile_photos')
      .select('id, storage_path, position, is_primary')
      .eq('profile_id', profileId)
      .order('position', { ascending: true });
    if (remErr) return jsonResponse({ error: remErr.message }, req, 500);
    const remaining = (remainRows ?? []) as { id: string; storage_path: string; position: number; is_primary: boolean }[];
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position === i) continue;
      const { error } = await admin
        .from('profile_photos')
        .update({ position: i })
        .eq('id', remaining[i].id)
        .eq('profile_id', profileId);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    }
    let primary = remaining.find((r) => r.is_primary) ?? null;
    if (!primary && remaining.length > 0) {
      primary = remaining[0];
      const { error } = await admin
        .from('profile_photos')
        .update({ is_primary: true })
        .eq('id', primary.id)
        .eq('profile_id', profileId);
      if (error) return jsonResponse({ error: error.message }, req, 500);
    }
    const { error: syncErr } = await admin
      .from('profiles')
      .update({ photo_url: primary?.storage_path ?? null })
      .eq('id', profileId);
    if (syncErr) return jsonResponse({ error: syncErr.message }, req, 500);

    await admin.from('admin_actions').insert({
      admin_user_id: callerId,
      target_profile_id: profileId,
      action_type: 'photo_removed_by_admin',
      notes: reason,
    });

    let emailSent = false;
    if (isTransactionalMailConfigured()) {
      const sent = await dispatchEmail(admin, {
        type: 'photo_removed_by_admin',
        recipientProfileId: profileId,
        extraData: { reason },
      });
      emailSent = sent.ok;
    }

    return jsonResponse({ ok: true, remaining_photos: remaining.length, email_sent: emailSent }, req);
  }

  if (action === 'promote' || action === 'demote') {
    if (isSupportAdmin(userData.user)) {
      return jsonResponse({ error: 'Support admin role cannot change admin accounts' }, req, 403);
    }
    const targetId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!targetId) {
      return jsonResponse({ error: 'user_id required' }, req, 400);
    }

    if (action === 'promote') {
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
      if (gErr || !target.user) {
        return jsonResponse({ error: 'User not found' }, req, 404);
      }
      const am = {
        ...(target.user.app_metadata as Record<string, unknown> | undefined),
        is_admin: true,
        admin_role: 'super',
      };
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: am });
      if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
      return jsonResponse({ ok: true }, req);
    }

    if (action === 'demote') {
      if (targetId === callerId) {
        return jsonResponse({ error: 'You cannot demote your own account' }, req, 400);
      }
      let adminCount = 0;
      let page = 1;
      const perPage = 1000;
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) return jsonResponse({ error: error.message }, req, 500);
        const batch = data?.users ?? [];
        for (const u of batch) {
          const am = u.app_metadata as Record<string, unknown> | undefined;
          if (metaIsAdminFlag(am?.is_admin)) adminCount++;
        }
        if (batch.length < perPage) break;
        page++;
      }
      if (adminCount <= 1) {
        return jsonResponse({ error: 'Cannot demote the last admin' }, req, 400);
      }
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(targetId);
      if (gErr || !target.user) {
        return jsonResponse({ error: 'User not found' }, req, 404);
      }
      const prev = { ...(target.user.app_metadata as Record<string, unknown> | undefined) };
      prev.is_admin = false;
      delete prev.admin_role;
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: prev });
      if (uErr) return jsonResponse({ error: uErr.message }, req, 500);
      return jsonResponse({ ok: true }, req);
    }
  }

  return jsonResponse({ error: 'Unknown action' }, req, 400);
});
