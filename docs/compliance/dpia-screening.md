# DPIA screening - matrimonial register

UK GDPR Articles 35-36 expect a Data Protection Impact Assessment when processing is likely to result in **high risk** to rights and freedoms.

## When to escalate to full DPIA

Complete a DPIA when you answer **yes** to any of:

1. Large-scale systematic monitoring or profiling affecting members ([CONFIRM thresholds with ICO guidance]).
2. Special category **on a meaningful scale**, especially visible to peer members alongside contact details ([CONFIRM]).
3. New technology or major change affecting visibility (e.g. exposing private fields broadly, integrating third-party tracking, exporting public datasets).
4. Automated decisions with legal/significant effects on individuals.

Matrimonial services often warrant at least documenting this screening outcome.

## Quick screening questionnaire (adapt and file)

| Question | Notes |
| --- | --- |
| Do we evaluate personal aspects systematically (beyond manual admin review)? | [ ] Yes → describe / [ ] No |
| Could members be harmed if data is leaked (reputation, coercive contact, safeguarding)? | [ ] Yes → mitigations documented |
| Is processing beyond what members realistically expect despite the Privacy policy? | [ ] Yes → redesign or DPIA |

## Documented mitigation (engineering)

Row-level visibility rules (`profiles` SELECT policies); age gate; transactional email only via configured providers; audited admin exports; ID document purge on approve/reject; optional registrant IP HMAC tied to submission consent audit.

## Outcome

Record one of:

- **DPIA not required** - reasons: [fill]
- **DPIA initiated** - reference: [fill], owner: [fill], ICO consultation if high residual risk without mitigation
