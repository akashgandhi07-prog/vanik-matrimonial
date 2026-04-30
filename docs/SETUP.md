# Vanik Matrimonial Register - setup notes

## First admin account

1. Register a user through the normal `/register` flow and complete email verification.
2. In the [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Users**, open that user.
3. Under **App metadata** (raw `app_metadata`), set JSON that includes `"is_admin": true`. Do **not** rely on **User metadata** for admin - clients can edit `user_metadata`; only `app_metadata` is trusted by the app and database policies.
4. Enrol **MFA (TOTP)** for this account when you first open `/admin` (required by the app).

## Second (and further) admin accounts

**Option A - Dashboard (same as first)**  
Repeat the steps above for another verified user: set `app_metadata.is_admin` to `true`.

**Option B - From an existing admin**  
1. Sign in as an admin and open **Admin → Settings**.  
2. Find the target user in the list (they must already have a Supabase Auth account, e.g. after self-registration).  
3. Click **Promote**. This calls the `admin-manage-users` Edge Function, which uses the service role to set `app_metadata.is_admin = true`.  
4. The new admin must complete MFA on first visit to `/admin`.

**Demotion**  
Use **Demote** on Settings. You cannot demote yourself, and you cannot demote the last remaining admin.

## Environment and Edge Functions

- Set secrets in the Supabase project (Edge Function secrets): `RESEND_API_KEY`, `PUBLIC_SITE_URL`, `CRON_SECRET` (required for scheduled jobs), etc.  
- Deploy functions after pulling migrations: `supabase db push` / `supabase functions deploy`.

See `.env.example` for frontend (`VITE_*`) variables and optional CORS-related Edge secrets.

## Pre-launch URL alignment (Vercel + Supabase)

Use one **canonical** public origin everywhere (for example `https://matrimonial.vanikcouncil.uk` or your Vercel production URL).

1. **Vercel (or other host)**  
   - Set `VITE_PUBLIC_SITE_URL` to that origin (no trailing slash).  
   - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the production Supabase project.

2. **Supabase → Edge Functions → Secrets**  
   - Set `PUBLIC_SITE_URL` to the same origin. Used in transactional emails and as a fallback for Stripe return URLs.  
   - If you use extra browser origins (e.g. `www.` or a second domain), add them to `CORS_ALLOWED_ORIGINS` (comma-separated). The Edge CORS helper also allows `https://matrimonial.vanikcouncil.uk`, localhost, and (by default) `https://*.vercel.app`.

3. **Supabase → Authentication → URL Configuration**  
   - **Site URL** = canonical origin.  
   - **Redirect URLs** = that origin’s paths, any preview URLs you use, and local dev (`http://localhost:3000/**`, etc.).

4. **Checks**  
   - Run the browser tests in [SECURITY_RLS_PRELAUNCH.md](./SECURITY_RLS_PRELAUNCH.md) on staging.  
   - If Stripe is enabled, follow [STRIPE_LAUNCH.md](./STRIPE_LAUNCH.md).

## Browse: no profiles troubleshooting

If the member **Browse** page loads but shows no candidates, the database is only returning profiles that match all of the following (enforced by RLS / `browse_opposite_profiles`):

- The viewer’s **seeking_gender** (under Browse or My profile) matches the candidate’s gender, or seeking is **Both**.
- Candidate **status** is **active**, **show_on_register** is true, and **membership_expires_at** is in the future.
- The candidate row has **auth_user_id** linked to a real login (not a placeholder account).

Run `supabase/verify_browse_setup.sql` in the Supabase SQL editor for the **same** project the app uses to verify migrations, policies, and sample data. Also confirm `VITE_SUPABASE_URL` points at that project.
