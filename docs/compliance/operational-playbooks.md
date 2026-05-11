# Operational GDPR playbooks — Vanik Council

Council staff procedures. Adjust to your delegated roles and archiving policy.

---

## 1. Subject access request (SAR)

1. **Verify identity** using a proportional method (registered email confirmation, postal match, attendance at verified office session — council policy decides).
2. **Locate data**: admin member record (profile + `member_private`), photos, Stripe membership rows reachable via tooling, logs in `email_log`, `admin_actions`, contact requests (`requests`) and feedback tied to profile [CONFIRM completeness].
3. **Collate**: provide a coherent package (typically within one month; up to three months allowed for complex cases with explanation).
4. **Redact** third-party data that is not the requester’s unless fair to include.
5. **Log** the SAR and response date in council records (not necessarily in-app).

---

## 2. Erasure (“right to be forgotten”)

**Not absolute** — balance against contract, legal obligation, and substantial public interest/safeguarding.

1. Verify identity.
2. Legal check: can we erase entirely or must we retain a minimal record (e.g. safeguarding incident)?
3. **Technical erasure** (super admin): use permanent delete tooling that removes auth user, profile cascade, storage objects (photos, ID if any), and nulls foreign keys to logs where implemented — see `admin-manage-users` `delete_members_permanent`.
4. **Processor follow-up**: confirm Stripe data handling per their retention (may require separate account closure request).
5. Confirm erasure to the individual unless silence is required for security.

---

## 3. Personal data breach — 72-hour ICO clock

1. **Contain** (revoke sessions, rotate keys if compromised, block affected admin accounts).
2. **Assess risk** to individuals (confidentiality, integrity, availability); document facts and timeline.
3. **Notify ICO** within 72 hours if likely to result in risk to rights and freedoms (controller form on ICO website).
4. **Notify individuals** without undue delay if **high** risk.
5. **Record** in breach log: cause, categories, measures, DPO/trustee sign-off.

---

## 4. Admin export policy

Exports of member data (`export_members_csv`, `export_emails`, JSON copy in admin UI) are **high risk**.

- **Principle**: role-based need; super-admin only where implemented; support role restricted.
- **Every export** should create an `admin_actions` row (implemented for CSV email exports).
- **Storage**: do not leave CSVs on shared drives without encryption; delete when no longer needed.
- **Transport**: avoid personal email; use council-approved channels.

---

## 5. Policy and consent version changes

1. Update `src/pages/Privacy.tsx` and bump **`PRIVACY_POLICY_VERSION_ID`** in `src/lib/privacyPolicyVersion.ts`.
2. Match **`DEFAULT_PRIVACY_POLICY_VERSION_ID`** in `supabase/functions/_shared/privacy-policy-version.ts` or set Edge secret **`PRIVACY_POLICY_VERSION`** temporarily without redeploying the app shell.
3. Deploy site + Edge functions so new submissions record the new version.
4. **Existing members**: consider whether re-consent is required for material changes to special category processing or visibility [legal advice].

---

## 6. Optional `REGISTRATION_CONSENT_IP_HMAC_SECRET`

- Enables `registration_submitter_ip_hash` on `member_private` for abuse investigation without storing raw IP indefinitely.
- Rotate by treating old hashes as historical only; changing the secret does not retrofit past rows.
- Document retention of hashes in RoPA alongside other consent fields.
