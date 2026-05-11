#!/usr/bin/env node
/**
 * Seeds 10 male + 10 female demo matrimonial accounts (active, approved photos, visible in browse).
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment,
 * or in a project-root .env file.
 *
 * Downloads stock portrait images (randomuser.me CDN), uploads to bucket `profile-photos`.
 *
 * Usage: node scripts/seed_demo_accounts.mjs
 * Env:   SEED_DEMO_PASSWORD (default: VanikDemo2026!)
 *       SEED_DEMO_PHOTOS_ONLY=1  — only uploads profile photos for existing vanik-demo-* accounts (pairs with DB migration seed).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnvFile() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const demoPassword = process.env.SEED_DEMO_PASSWORD?.trim() || 'VanikDemo2026!';
const photosOnly =
  process.env.SEED_DEMO_PHOTOS_ONLY === '1' || process.env.SEED_DEMO_PHOTOS_ONLY === 'true';

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Add the service role key from Supabase → Project Settings → API (never commit it or expose it in the browser).\n' +
      'Example: export SUPABASE_SERVICE_ROLE_KEY="eyJ…" && npm run seed:demo'
  );
  if (process.env.VITE_SUPABASE_ANON_KEY && !serviceKey) {
    console.error('\n(You already have VITE_SUPABASE_ANON_KEY; the seed script needs the service_role key, not the anon key.)');
  }
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** @param {'men'|'women'} kind @param {number[]} seeds */
function portraitUrls(kind, seeds) {
  return seeds.map((n) => `https://randomuser.me/api/portraits/med/${kind}/${n}.jpg`);
}

async function fetchImageBytes(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error(`Image too small from ${url}`);
  return buf;
}

const MEMBERSHIP_UNTIL = new Date();
MEMBERSHIP_UNTIL.setFullYear(MEMBERSHIP_UNTIL.getFullYear() + 3);

const MALE_NAMES = [
  'Arjun',
  'Rohan',
  'Kiran',
  'Dev',
  'Raj',
  'Neil',
  'Aarav',
  'Karan',
  'Amit',
  'Jay',
];
const FEMALE_NAMES = [
  'Priya',
  'Ananya',
  'Kavya',
  'Diya',
  'Sara',
  'Meera',
  'Riya',
  'Shreya',
  'Nisha',
  'Kavita',
];
const SURNAMES = [
  'Patel',
  'Shah',
  'Mehta',
  'Kapadia',
  'Desai',
  'Joshi',
  'Gandhi',
  'Shah',
  'Modi',
  'Gupta',
  'Parekh',
];
const EDUCATION = [
  'MSc Computer Science',
  'MBA',
  'BEng Mechanical',
  'LLB',
  'BSc Economics',
  'Pharmacy degree',
  'Medicine (MBBS)',
  'Architecture BA',
  'Accounting (ACCA)',
  'Dentistry BDS',
];
const JOBS = [
  'Software engineer',
  'Project manager',
  'Pharmacist',
  'Solicitor',
  'Chartered accountant',
  'Dentist',
  'Civil engineer',
  'Marketing lead',
  'GP trainee',
  'Data analyst',
];

function ukMobile(i) {
  const last = String(7700000000 + i).slice(-9);
  return `07${last.slice(0, 2)} ${last.slice(2, 6)} ${last.slice(6)}`;
}

/**
 * Downloads two JPEGs and fills profile_photos + profiles.photo_url.
 * @param {string} hintLabel logged on errors
 */
async function upsertDemoProfilePhotos(hintLabel, profileId, authUserId, gender, idx) {
  const kind = gender === 'Male' ? 'men' : 'women';
  const n1 = ((idx * 11 + 3) % 90) + 1;
  const n2 = ((idx * 17 + 41) % 90) + 1;
  const urls = portraitUrls(kind, [n1, n2]);

  const photoPaths = [];
  for (let pi = 0; pi < urls.length; pi++) {
    const bytes = await fetchImageBytes(urls[pi]);
    const objectPath = `${gender}/${authUserId}/demo-seed-${pi}.jpg`;
    const { error: upErr } = await admin.storage.from('profile-photos').upload(objectPath, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) {
      console.error(`Photo upload failed ${hintLabel} ${objectPath}: ${upErr.message}`);
      continue;
    }
    photoPaths.push(objectPath);
  }

  if (photoPaths.length) {
    const rows = photoPaths.map((storage_path, position) => ({
      profile_id: profileId,
      storage_path,
      position,
      is_primary: position === 0,
    }));
    const { error: phErr } = await admin.from('profile_photos').insert(rows);
    if (phErr) console.warn(`profile_photos insert ${hintLabel}: ${phErr.message}`);
    await admin.from('profiles').update({ photo_url: photoPaths[0], photo_status: 'approved' }).eq('id', profileId);
  }
}

async function seedPhotosOnlyForEmail(email, gender, idx) {
  const { data: mp, error } = await admin.from('member_private').select('profile_id').eq('email', email).maybeSingle();
  if (error) throw error;
  if (!mp?.profile_id) {
    console.log(`Photos skip — no member_private row for ${email}`);
    return;
  }
  const pid = mp.profile_id;
  const { data: existingPhotos, error: listErr } = await admin
    .from('profile_photos')
    .select('storage_path')
    .eq('profile_id', pid);
  if (listErr) throw listErr;
  if (existingPhotos?.length) {
    const paths = existingPhotos.map((r) => r.storage_path).filter(Boolean);
    if (paths.length) await admin.storage.from('profile-photos').remove(paths).catch(() => null);
    const { error: delErr } = await admin.from('profile_photos').delete().eq('profile_id', pid);
    if (delErr) throw delErr;
  }

  const { data: viewer, error: pErr } = await admin
    .from('profiles')
    .select('auth_user_id')
    .eq('id', pid)
    .maybeSingle();
  if (pErr) throw pErr;
  const authUserId = viewer?.auth_user_id;
  if (!authUserId) {
    console.warn(`Photos skip — no auth_user_id for profile ${pid}`);
    return;
  }
  await upsertDemoProfilePhotos(email, pid, authUserId, gender, idx);
  console.log(`Photos OK ${email}`);
}

async function emailExists(email) {
  const { data } = await admin.from('member_private').select('profile_id').eq('email', email).maybeSingle();
  return !!data?.profile_id;
}

/**
 * @param {object} spec
 * @param {'Male'|'Female'} spec.gender
 * @param {string} spec.email
 * @param {string} spec.firstName
 * @param {number} spec.idx
 */
async function seedOne(spec) {
  const { gender, email, firstName, idx } = spec;
  if (await emailExists(email)) {
    console.log(`Skip (already seeded): ${email}`);
    return { skipped: true, email };
  }

  const surname = SURNAMES[idx % SURNAMES.length];
  const seeking = gender === 'Male' ? 'Female' : 'Male';
  const yob = 1988 + (idx % 12);
  const dob = `${yob}-${String((idx % 12) + 1).padStart(2, '0')}-${String((idx % 27) + 1).padStart(2, '0')}`;

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: demoPassword,
    email_confirm: true,
  });
  if (authErr || !authData?.user) {
    throw new Error(`createUser ${email}: ${authErr?.message ?? 'no user'}`);
  }
  const userId = authData.user.id;

  const rollBackAuth = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => null);
  };

  const profileRow = {
    id: userId,
    auth_user_id: userId,
    first_name: firstName,
    gender,
    seeking_gender: seeking,
    status: 'active',
    photo_status: 'approved',
    show_on_register: true,
    membership_expires_at: MEMBERSHIP_UNTIL.toISOString(),
    browse_paused: false,
    education: EDUCATION[idx % EDUCATION.length],
    job_title: JOBS[idx % JOBS.length],
    height_cm: gender === 'Male' ? 172 + (idx % 14) : 158 + (idx % 12),
    diet: ['Veg', 'Vegan', 'Non-veg'][idx % 3],
    religion: 'Hindu',
    community: null,
    nationality: 'British',
    place_of_birth: 'London',
    town_country_of_origin: 'UK',
    future_settlement_plans: 'Flexible within the UK.',
    hobbies: 'Travel, reading, family gatherings, fitness.',
  };

  const { data: insProf, error: pErr } = await admin.from('profiles').insert(profileRow).select('id').single();
  if (pErr || !insProf) {
    await rollBackAuth();
    throw new Error(`profiles insert ${email}: ${pErr?.message ?? 'unknown'}`);
  }
  const profileId = insProf.id;

  const { error: mpErr } = await admin.from('member_private').insert({
    profile_id: profileId,
    surname,
    date_of_birth: dob,
    email,
    mobile_phone: ukMobile(10000 + idx * 137 + (gender === 'Female' ? 1 : 0)),
    home_address_line1: `${10 + idx} Demo Street`,
    home_address_city: 'London',
    home_address_postcode: `SW1A 1${idx}A`,
    home_address_country: 'UK',
    father_name: `Mr ${surname}`,
    mother_name: `Mrs ${surname}`,
    id_document_url: null,
  });
  if (mpErr) {
    await admin.from('profiles').delete().eq('id', profileId);
    await rollBackAuth();
    throw new Error(`member_private insert ${email}: ${mpErr.message}`);
  }

  const { data: refData, error: refErr } = await admin.rpc('assign_next_reference_number', {
    p_profile_id: profileId,
    p_gender: gender,
  });
  if (refErr) {
    console.warn(`Reference number failed for ${email}: ${refErr.message}`);
  }

  await upsertDemoProfilePhotos(email, profileId, userId, gender, idx);

  const ref = refData ?? '(see DB)';
  console.log(`OK ${email} • ${firstName} ${surname} • ref ${ref}`);
  return { email, reference: refData, profile_id: profileId };
}

async function main() {
  if (photosOnly) {
    console.log('SEED_DEMO_PHOTOS_ONLY: uploads for vanik-demo-* accounts seeded via SQL migration…');
    for (let i = 0; i < 10; i++) {
      const email = `vanik-demo-male-${String(i + 1).padStart(2, '0')}@example.com`;
      await seedPhotosOnlyForEmail(email, 'Male', i);
    }
    for (let i = 0; i < 10; i++) {
      const email = `vanik-demo-female-${String(i + 1).padStart(2, '0')}@example.com`;
      await seedPhotosOnlyForEmail(email, 'Female', i);
    }
    console.log('\nPhoto pass complete.');
    return;
  }

  console.log('Seeding demo accounts (20 total)…');
  const results = [];

  for (let i = 0; i < 10; i++) {
    const email = `vanik-demo-male-${String(i + 1).padStart(2, '0')}@example.com`;
    results.push(await seedOne({ gender: 'Male', email, firstName: MALE_NAMES[i], idx: i }));
  }
  for (let i = 0; i < 10; i++) {
    const email = `vanik-demo-female-${String(i + 1).padStart(2, '0')}@example.com`;
    results.push(await seedOne({ gender: 'Female', email, firstName: FEMALE_NAMES[i], idx: i }));
  }

  const created = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\nDone. Created: ${created.length}, skipped: ${skipped.length}.`);
  console.log(`Shared demo password: ${demoPassword}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
