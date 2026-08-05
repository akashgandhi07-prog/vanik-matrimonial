-- Rotate the seeded demo accounts' passwords so the committed credential is dead.
--
-- 20260511120000_seed_demo_accounts.sql provisions ~20 live auth.users with
-- encrypted_password = crypt('VanikDemo2026!', ...). That password is in the repo,
-- so anyone can sign in as any demo member. This migration overwrites each demo
-- account's password hash with an unguessable random value, killing the committed
-- credential. (scripts/seed_demo_accounts.mjs is updated separately to take the
-- password from an env var so no real credential is committed going forward.)
--
-- The public /demo page does NOT depend on these passwords: demo-browse-profiles
-- reads the demo PROFILES via the service role (status='active', hidden_reason IS
-- NULL, membership_expires_at > now()) and nothing signs in as the demo users. So we
-- deliberately leave the demo profiles' status/visibility untouched and only rotate
-- the auth passwords.
--
-- Idempotent and safe either way: matches every vanik-demo-* auth user by email
-- (the seeded pattern is vanik-demo-male-NN@example.com / vanik-demo-female-NN@…);
-- affects 0 rows if the accounts were never provisioned. Re-running simply rotates
-- to a fresh random value.

SET search_path = public, extensions;

UPDATE auth.users
SET encrypted_password = crypt(gen_random_uuid()::text || clock_timestamp()::text, gen_salt('bf')),
    updated_at = now()
WHERE email LIKE 'vanik-demo-%';
