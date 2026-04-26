# Stripe checklist (launch)

Use this when `STRIPE_SECRET_KEY` and `STRIPE_MEMBERSHIP_PRICE_ID` are set on Edge Functions (paid registration / renewals).

## Webhook

1. In [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks**, add an endpoint:
   - **URL:** `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`
2. Subscribe to event: **`checkout.session.completed`**.
3. Copy the endpoint **Signing secret** (`whsec_...`) into Supabase Edge secrets as **`STRIPE_WEBHOOK_SECRET`**.
4. Deploy the `stripe-webhook` function after setting secrets.

Without a valid webhook secret, the handler rejects requests. Without the webhook, **renewals** (extending `membership_expires_at` after Checkout) will not apply automatically; registration submission still verifies payment via the Stripe API in `submit-registration`.

## Live vs test

Use **live** keys and **live** webhook secret in production. Test mode keys only work with test-mode webhooks.

## When a renewal payment succeeds but membership does not update

The webhook records the session in `stripe_checkout_sessions` and then updates the profile. If the profile update fails, the function returns **500** so Stripe retries; the session row is kept so retries hit **idempotency** (duplicate key) and eventually return 200.

If you see logs like `profile renewal update failed - payment recorded, membership NOT extended`:

1. In Supabase **Table Editor**, open `stripe_checkout_sessions` for the `checkout_session_id` (or latest row for that user/profile).
2. Confirm `purpose = renewal`, `payment_status = paid`, and `renewal_applied_at` / row exists.
3. In **`profiles`**, manually set `membership_expires_at` (extend one year from the previous expiry or from today, per your policy), set `status = 'active'` and `show_on_register = true` if appropriate.
4. Investigate the DB error from function logs (permissions, constraint, etc.) so it does not recur.

## Monitoring

- Stripe Dashboard → **Webhooks** → endpoint: check delivery success rate and response codes.  
- Supabase → **Edge Functions** → `stripe-webhook` → logs for errors after deploys or schema changes.
