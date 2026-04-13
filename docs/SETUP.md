# Vanik Matrimonial Register — setup notes

## First admin account

1. Register a user through the normal `/register` flow and complete email verification.
2. In the [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Users**, open that user.
3. Under **User metadata**, add JSON: `{ "is_admin": true }` (or edit raw `user_metadata` to include `"is_admin": true`).
4. Optionally set the same flag under **App metadata** if you rely on `app_metadata.is_admin` anywhere.
5. Enrol **MFA (TOTP)** for this account when you first open `/admin` (required by the app).

## Second (and further) admin accounts

**Option A — Dashboard (same as first)**  
Repeat the steps above for another verified user: set `user_metadata.is_admin` to `true`.

**Option B — From an existing admin (after Phase 3)**  
1. Sign in as an admin and open **Admin → Settings**.  
2. Find the target user in the list (they must already have a Supabase Auth account, e.g. after self-registration).  
3. Click **Promote**. This calls the `admin-manage-users` Edge Function, which uses the service role to set `user_metadata.is_admin = true`.  
4. The new admin must complete MFA on first visit to `/admin`.

**Demotion**  
Use **Demote** on Settings. You cannot demote yourself, and you cannot demote the last remaining admin.

## Environment and Edge Functions

- Set secrets in the Supabase project (Edge Function secrets): `RESEND_API_KEY`, `PUBLIC_SITE_URL`, etc.  
- Deploy functions after pulling migrations: `supabase db push` / `supabase functions deploy`.

See `.env.example` for frontend (`VITE_*`) variables.
