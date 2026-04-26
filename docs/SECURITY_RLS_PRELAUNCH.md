# Pre-launch RLS checks (manual)

Run these in a **staging** Supabase project (or a production dry-run) before go-live. Use a normal **member** account (not admin) in an incognito window.

Record results in the table at the end; keep the log with your release notes.

## Preconditions

1. Note **staging project ref / URL** (for the results log): ____________________  
2. Create **Member A** (test member) - complete registration and approval if required.  
3. Create **Member B** - another account so there is another row in `member_private` / `profiles`.  
4. In the browser where **Member A** is signed in, open DevTools → **Console**.

## Tests (Supabase JS in the browser)

Use the same anon client the app uses (`supabase` from your bundle), or paste after `const { createClient } = await import('@supabase/supabase-js')` with your project URL + anon key.

### 1. Cannot read other members’ private data

```js
const { data, error } = await supabase.from('member_private').select('*');
```

**Expected:** Only the row for Member A’s profile (or empty/error if RLS returns no rows). **Must not** include Member B’s email, phone, or address.

### 2. Cannot read coupons as a member

```js
const { data, error } = await supabase.from('coupons').select('*');
```

**Expected:** Empty array `[]` or a permission error - **not** a full list of coupon codes.

### 3. Admin routes blocked for members

While signed in as Member A (non-admin), open `/admin` in the same browser.

**Expected:** Redirect to `/dashboard/browse` (or login if session missing). Member A must **not** see the admin overview.

## Results log (fill in before go-live)

| Check | Tester | Date | Pass/Fail | Notes |
|-------|--------|------|-----------|-------|
| member_private isolation | | | | |
| coupons blocked | | | | |
| /admin blocked | | | | |

**Pass** = behaviour matches “Expected” for every test. **Fail** = stop release: fix RLS (or related policies), re-run the full checklist, then update this table.

If any check **fails**, fix RLS policies or policies on related tables before migrating production data.

### Optional: quick SQL sanity (staging, service role or SQL editor)

These do not replace the browser tests above; they help confirm tables exist and RLS is enabled:

```sql
-- member_private and coupons should have RLS enabled (true) in production-like projects
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('member_private', 'coupons')
  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
```
