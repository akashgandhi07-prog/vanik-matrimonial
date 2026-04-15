# Request Flow Regression Checks

## Saved modal CTA behavior
- Sign in as a member and open `My saved`.
- Open any saved profile that is **not** already requested.
- Confirm the modal does **not** show an actionable `Request contact details` button.
- Confirm helper copy directs user to request from `Browse`.

## Browse submit behavior
- In `Browse`, add 1-3 candidates to tray and submit.
- Verify tray clears and contact modal opens on successful response.
- Verify tray does **not** clear when backend returns a structured error (`weekly_limit`, `feedback_required`, or `already_requested_this_week`).

## Weekly limit race protection
- Run `supabase/verify_request_flow_setup.sql`.
- In two SQL tabs, execute the same `create_contact_request_atomic(...)` call simultaneously.
- Confirm only one call creates a request, and the other returns an error code.
