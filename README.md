# Vanik Matrimonial Register

A private, members-only matrimonial introduction platform for Hindu and Jain families in the UK, run by Vanik Council volunteers. Members register, are verified by the volunteer team, then browse verified profiles and request introductions from their dashboard. It handles sensitive personal data, so every profile is verified before it appears and contact details are shared only inside the member dashboard on request.

Built by Junopets. Frontend is React + Vite + TypeScript; the backend (auth, database, file storage, Edge Functions) runs on Supabase. Hosted on Vercel.

## Scripts

- `npm run dev` - start the Vite dev server (defaults to http://localhost:3000)
- `npm run build` - type-check (`tsc -b`) and produce the production build
- `npm run lint` - run ESLint over the project
- `npm run preview` - preview the production build locally
- `npm run seed:demo` - seed demo accounts (see `scripts/seed_demo_accounts.mjs`)

## Prerequisites and environment

- Node.js and npm.
- A Supabase project for auth, database, storage, and Edge Functions.
- Copy `.env.example` to `.env` and set the values (at minimum `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_SITE_URL`). `.env.example` documents every frontend `VITE_*` variable and the optional Edge Function secrets (email/SMTP, CORS, Stripe, cron).

## Documentation

- `docs/SETUP.md` - full setup: first admin account, Edge Functions and secrets, and pre-launch URL alignment across Vercel, Supabase Auth, and Edge.
- `docs/STRIPE_LAUNCH.md` - enabling card payments (registration and renewals) via Stripe Checkout.
- `docs/SECURITY_RLS_PRELAUNCH.md` - row-level-security checks to run before launch.
