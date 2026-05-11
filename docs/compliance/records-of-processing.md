# Records of processing (RoPA) — Vanik Matrimonial Register

**Template for the data controller (Vanik Council).** Complete and store with your governance records; update after material changes.

| Field | Draft content — replace [CONFIRM] with council decisions |
| --- | --- |
| **Processing activity name** | Vanik Council Matrimonial Register — memberships, approvals, introductions |
| **Controller** | Vanik Council — matrimonial@vanikcouncil.uk |
| **DPO contact** | [CONFIRM — name / email / “none appointed” per ICO guidance] |
| **Categories of data subjects** | Applicants; approved members (and former members once archived/deleted); council administrators |
| **Categories of personal data** | Names, demographics, eligibility and matching fields (including religion where provided), addresses, parental names, telephone, images, safeguarding notes, transactional email metadata; optional IP-derived hash at registration submit when enabled |
| **Special category data** | Religion (explicit); diet/community may be sensitive in context — document Article 9 condition (e.g. explicit consent and/or Schedule 1 substantial public interest/safeguarding as advised) |
| **Purposes** | Run the register: verify identity, display permitted profile fields, manage membership and renewals, contact requests, safeguarding, operational logging, finance reconciliation |
| **Lawful bases (Article 6)** | Contract; consent (declarations at registration; optional feedback); legal obligation; legitimate interests (security, abuse prevention, admin audit); special category conditions per legal advice |
| **Recipients** | Authorised council staff; processors: Supabase (auth/DB/storage/functions), Stripe (payments), email provider (SMTP/Resend), website host [CONFIRM] |
| **Transfers outside UK** | [CONFIRM Supabase project region; Stripe/Resend locations]. Safeguards: UK IDTA / Addendum + SCCs as applicable; processor DPAs on file |
| **Retention** | Document per category (active membership, lapse, rejection, audit logs, payment records); align with Privacy page and actual cron/admin practice |
| **Security measures** | RLS policies, MFA for admins [CONFIRM], least-privilege roles, HTTPS, audited exports, deletion routines for identity documents |
| **Automated decisions** | [CONFIRM “none” or describe profiling if added] |

**Linked controls in this repository**

- Privacy copy: `src/pages/Privacy.tsx`
- Consent versioning: `src/lib/privacyPolicyVersion.ts` and Edge `_shared/privacy-policy-version.ts`
- Consent persistence: migration `supabase/migrations/20260511130100_member_private_registration_consents.sql`, function `submit-registration`
