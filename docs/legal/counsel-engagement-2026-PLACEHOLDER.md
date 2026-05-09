# Compliance Counsel Engagement · v1 Mobile App Launch

**Status:** PLACEHOLDER — must be replaced with executed engagement letter before Phase 11.5 (compliance hardening) starts.

**Related plan unit:** U0a (Phase -1)

## Why this exists

The iOS plan (`docs/plans/2026-05-09-001-feat-ios-swiftui-kolaleaf-mobile-app-plan.md`) references "AUSTRAC compliance officer" three times (U76f compliance copy review, U85 pre-submission App Store review, R14 ongoing change-of-copy review). The r2 doc-review surfaced that the role was unidentified.

This document is the placeholder to track that engagement until the real letter is signed.

## What we need from counsel

1. **Pre-launch copy review (U76f).** Single pass over every user-facing string in the iOS app — error states, KYC outcomes, failure paths, transaction-state-facing copy (especially `FLOAT_INSUFFICIENT`, `EXPIRED`, `NEEDS_MANUAL`). Counsel flags any string that:
   - Implies a guarantee ("instant", "always", "guaranteed")
   - Exposes treasury reasoning (anything that names _why_ float is paused)
   - Misrepresents AUSTRAC obligations
   - Conflicts with ASIC's financial-services communication guidance

2. **Pre-submission App Store review (U85 prep).** Counsel reviews:
   - In-app disclosures (Account → About)
   - App Store metadata (description, keywords)
   - Privacy policy URL parity vs. App Store privacy questionnaire
   - License-mention placement

3. **Ongoing change-of-copy review.** Any post-launch change to transaction-state-facing copy must run past counsel within 3 business days.

## SLA expectations

- **Initial review (U76f pass):** 5 business days for first pass, 2 days for follow-ups
- **Pre-submission (U85):** 3 business days
- **Ongoing changes:** 3 business days for transactional copy; 5 business days for marketing copy

## Counsel qualifications required

- Australian financial-services counsel
- Familiarity with AUSTRAC RG 105/106 (designated services + AML/CTF program obligations)
- Experience with consumer fintech mobile apps (preferred)
- Ability to bless launch-blocking copy decisions (i.e., authority to sign off, not just advise)

## Engagement timeline

| Milestone                | Target date                            | Owner             |
| ------------------------ | -------------------------------------- | ----------------- |
| Identify candidate firms | TBD                                    | Founder           |
| Initial scoping call     | TBD                                    | Founder           |
| Engagement letter signed | **MUST land before Phase 11.5 starts** | Founder           |
| First copy review begins | Phase 11.5 start                       | Bob → Counsel     |
| Pre-submission review    | Phase 12 (U85 prep)                    | Founder → Counsel |

## Action items before Phase 11.5

- [ ] Identify 2-3 candidate firms (referrals from CashRemit-era contacts; AUSTRAC industry directory)
- [ ] Scoping calls; pick firm
- [ ] Sign engagement letter
- [ ] Replace this placeholder with the executed letter (or a redacted summary + link to vault)

---

_This document is required by the iOS plan's Phase -1 (U0a). It is not legal advice and does not constitute an engagement._
