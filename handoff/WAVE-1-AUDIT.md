# Wave 1 Correctness Audit — Synthesis
*Written by Arch from three parallel scout reports. Picks the order for Wave 1 hardening before any Wave 2 work.*

---

## Inputs

- `handoff/WAVE-1-AUDIT/transfers.md` — transfer state machine
- `handoff/WAVE-1-AUDIT/kyc.md` — identity verification
- `handoff/WAVE-1-AUDIT/compliance.md` — AUSTRAC compliance

---

## Consolidated gap list

### P0 — Regulatory blockers / data-integrity (must fix before prod traffic)

| # | Gap | Domain | Source |
|---|---|---|---|
| 1 | **THRESHOLD ComplianceReport missing** — TTR required for AUD transfers ≥ $10,000. Zero constant, zero trigger, zero write. | compliance | compliance.md §Threshold reporting |
| 2 | **IFTI ComplianceReport missing** — International Funds Transfer Instruction required ≥ $1,000 AUD. Zero implementation. | compliance | compliance.md §ComplianceReport usage |
| 3 | **Reconciliation does not diff provider statements** — AUSTRAC requires diffing internal ledger against Monoova + Flutterwave records. Current job only ages internal rows. | compliance | compliance.md §Daily reconciliation |
| 4 | **`retryKyc` has no HTTP route** — fully implemented + tested but unrouted. REJECTED users permanently blocked with no in-app path forward. | KYC | kyc.md §Rejection + re-initiate |
| 5 | **Initial TransferEvent is `CREATED → CREATED` self-transition** — misleading audit trail; reconciliation tooling expects monotone progressions. | transfers | transfers.md §Gap P0 |

### P1 — Correctness / audit-log completeness

| # | Gap | Domain | Source |
|---|---|---|---|
| 6 | **Velocity check missing** — SMR trigger for frequency spikes; `src/lib/compliance/index.ts` is an empty stub. | compliance | compliance.md §Suspicious triggers |
| 7 | **LOGOUT not audited** — `revokeSession()` writes no AuthEvent; breaks 7-year authentication lifecycle record. | compliance | compliance.md §Audit log |
| 8 | **`admin/failed-emails/resolve` missing AuthEvent** — admin action not logged (Step 26 gap we just shipped). | compliance | compliance.md §Admin-action audit |
| 9 | **YELLOW / pending / created Sumsub events silently no-op** — no observability into manual-review stages; user stuck in IN_REVIEW with no ops signal. | KYC | kyc.md §Webhook event coverage |
| 10 | **`FLOAT_INSUFFICIENT → PROCESSING_NGN` edge dead** — valid in `VALID_TRANSITIONS` but no code triggers it; resume only goes to AUD_RECEIVED. | transfers | transfers.md §P1 |
| 11 | **`AWAITING_AUD → EXPIRED` uses `updatedAt`** — any row bump silently resets the 24h window. Should use `createdAt` or a dedicated `awaitingAudSince`. | transfers | transfers.md §P1 |
| 12 | **No dedicated expiry cron** — expiry bundled into daily reconciliation; if reconciliation fails, nothing expires. | transfers | transfers.md §P2 promoted |

### P2 — Detection surface / polish

| # | Gap | Domain |
|---|---|---|
| 13 | IP geolocation not implemented (CLAUDE.md-mentioned) | compliance |
| 14 | Device fingerprint not implemented (CLAUDE.md-mentioned) | compliance |
| 15 | `EMAIL_CHANGE_COMPLETED` not logged | compliance |
| 16 | `/kyc/initiate` has no rate limit (user can spam new Sumsub applicants) | KYC |
| 17 | `requireKyc` middleware is dead code at the route layer | KYC |
| 18 | `generatePayIdForTransfer` lacks a direct KYC guard (relies on upstream transfer gate) | KYC |
| 19 | `cancelTransfer` returns generic `InvalidTransitionError` on post-AUD cancel rather than a user-friendly message | transfers |

---

## Proposed Wave 1 hardening sequence

Consolidating the 19 gaps into minimum-change steps:

| Step | Scope | Closes gaps | Size | Domain priority |
|---|---|---|---|---|
| **27** | `retryKyc` HTTP route + Sumsub event coverage widen (YELLOW/pending/created → log + optional kycStatus nudge) + `/kyc/initiate` rate limit | 4, 9, 16 | small | unblocks real users NOW |
| **28** | AUSTRAC **TTR** (≥$10k AUD) + **IFTI** (≥$1k AUD international) ComplianceReport triggers. Constants, hook into `createTransfer`, paired tests. | 1, 2 | medium | single biggest regulatory exposure |
| **29** | Reconciliation rewrite — pull Monoova AUD statements + Flutterwave NGN payout records, diff vs internal ledger, emit `SUSPICIOUS` ComplianceReport on mismatch. | 3 | large | depends on provider-statement APIs being available in staging |
| **30** | Audit-log completeness + velocity check — LOGOUT AuthEvent, `admin/failed-emails/resolve` AuthEvent, `EMAIL_CHANGE_COMPLETED`, velocity SMR trigger in `src/lib/compliance/` | 6, 7, 8, 15 | small-medium | |
| **31** | Transfer state machine cleanup — nullable `fromStatus` on initial TransferEvent, remove/wire dead FLOAT_INSUFFICIENT edge, `awaitingAudSince` field for expiry, dedicated expiry cron, friendlier cancel error | 5, 10, 11, 12, 19 | medium | |
| **32** | Detection surface — IP geolocation, device fingerprint basic capture (no ML, just persist on Session rows) + `requireKyc` wiring at route layer + PayID KYC guard | 13, 14, 17, 18 | medium | defer until first SMR event exercises the system |

**Sequence rationale:**
1. **27 first** — smallest, unblocks real users (REJECTED-and-stuck is already a production risk), sets the pattern for Sumsub event coverage.
2. **28 before 29** — TTR/IFTI are pure code changes (threshold constants + triggers); reconciliation rewrite needs provider-statement API access we may not have in staging yet. Don't block on infra.
3. **30 before 31** — audit-log completeness is regulatory; transfer-machine cleanup is internal correctness. AUSTRAC exposure beats aesthetic monotonicity.
4. **32 last** — detection features add signal but the P0/P1 emit paths must exist first or there's nothing to feed signals into.

---

## Open questions for the Product Owner

Before starting Step 28 (TTR/IFTI):
1. **Final AUD TTR threshold:** AUSTRAC sets TTR at AUD $10,000. Confirm Kolaleaf's internal reporting threshold is exactly 10,000.00 AUD (no buffer) OR a buffer like $9,500 to avoid misses on FX fluctuation.
2. **IFTI scope:** confirm every AUD→NGN transfer is IFTI-reportable (AUSTRAC treats all cross-border flows above AUD $1,000 as IFTI). If yes, this is trivial — every transfer above threshold creates one.
3. **Report destination:** are the ComplianceReport rows meant to be consumed by a human via the admin dashboard, or auto-filed to AUSTRAC via their Entity Management system (EMS) API? If EMS API, that's a follow-on step.

Before starting Step 29 (reconciliation):
4. **Monoova + Flutterwave statement API access** — do we have staging credentials? Without them, Step 29 can only produce the diffing scaffold; the live pull runs later.

Before starting Step 32:
5. **IP geolocation provider** — MaxMind, IPinfo, or similar? License cost is a consideration.

---

## Not in Wave 1

Per `PILE-B-PLAN.md`'s non-goals and Wave 2 scope:
- Mobile apps (Wave 2, iOS weeks 10-20, Android weeks 14-24)
- Admin dashboard UI redesign
- Multi-corridor expansion (schema supports it; not enabling until AU-NGN is solid)
- Rate engine hardening beyond staleness-alert
- OpenTelemetry traces / `/metrics` Prometheus (Step 24 non-goals)

---

**Next action:** Arch reviews this synthesis, confirms the 5 Open Questions, and starts Step 27 (smallest + most user-unblocking).
