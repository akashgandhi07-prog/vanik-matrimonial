# Pre-launch RLS checks (manual)

Run these in a **staging** project before production migration. Use a normal **member** account (not admin) in an incognito window.

## Preconditions

1. Create **Member A** (test member) — complete registration and approval if required.  
2. Create **Member B** — another account so there is another row in `member_private` / `profiles`.  
3. In the browser where **Member A** is signed in, open DevTools → **Console**.

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

**Expected:** Empty array `[]` or a permission error — **not** a full list of coupon codes.

### 3. Admin routes blocked for members

While signed in as Member A (non-admin), open `/admin` in the same browser.

**Expected:** Redirect to `/dashboard/browse` (or login if session missing). Member A must **not** see the admin overview.

## Results log (fill in before go-live)

| Check | Tester | Date | Pass/Fail | Notes |
|-------|--------|------|-----------|-------|
| member_private isolation | | | | |
| coupons blocked | | | | |
| /admin blocked | | | | |

If any check **fails**, fix RLS policies or policies on related tables before migrating production data.
