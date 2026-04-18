# Wave 1 audit — AUSTRAC compliance

## ComplianceReport usage
- type=SUSPICIOUS: `src/lib/workers/reconciliation.ts:62` (stuck PROCESSING_NGN >1h), `src/lib/workers/staleness-alert.ts:48` (stale rate)
- type=THRESHOLD: MISSING — no write site exists anywhere in src/
- type=IFTI: MISSING — no write site exists anywhere in src/

## Threshold reporting
- Constant: MISSING — no AUSTRAC_THRESHOLD, TTR_THRESHOLD, or $10,000 AUD constant defined
- Write path: MISSING — `createTransfer` checks `corridor.maxAmount` and `user.dailyLimit` but emits no ComplianceReport when a transfer meets or exceeds the $10,000 AUD reporting threshold

## Suspicious-matter triggers
**Implemented:**
- Stale rate alert (`staleness-alert.ts:48`) — emits SUSPICIOUS when rate feed is stale
- Stuck PROCESSING_NGN >1h (`reconciliation.ts:62`) — emits SUSPICIOUS

**Missing (per CLAUDE.md):**
- Velocity check — no code monitors sudden increase in send frequency per user; `compliance/index.ts` is an empty export stub
- IP geolocation mismatch — `lib/http/ip.ts` exists but no geo-lookup or VPN/country mismatch flag
- Device fingerprint anomaly — not collected at login or transfer creation

## Daily reconciliation
- Monoova statement pull: MISSING — `runDailyReconciliation()` (`lib/workers/reconciliation.ts`) does not call Monoova API; it only ages internal transfers
- Flutterwave statement pull: MISSING — no Flutterwave statement fetch in any reconciliation path
- Ledger diff: STUB — worker expires/flags internal rows only; no external-vs-internal diff
- ComplianceReport on mismatch: MISSING — only SUSPICIOUS rows for stuck transfers, never for ledger discrepancies

## Transfer limits
- Per-transaction: EXISTS via corridor `minAmount`/`maxAmount` (`create.ts:47-58`)
- Per-day (sum vs User.dailyLimit): EXISTS — `create.ts:61-83` sums same-day non-terminal transfers and rejects if projected total exceeds `user.dailyLimit`
- AUSTRAC threshold trigger at per-transaction max: MISSING — no ComplianceReport emitted when `sendAmount` approaches or crosses $10,000 AUD

## Audit log completeness
**AuthEvent events covered:** LOGIN (`login.ts:130`), LOGIN_FAILED (`login.ts:75,89,118`), REGISTER (`register.ts:69`), TWO_FACTOR_VERIFIED (`verify-2fa/route.ts:38,52,67`), PASSWORD_CHANGED (`change-password/route.ts:76`), PASSWORD_CHANGE_FAILED (`change-password/route.ts:48`), PASSWORD_RESET (`reset-password/route.ts:61`), EMAIL_CHANGE_INITIATED (`change-email/route.ts:102`), EMAIL_CHANGE_FAILED (`change-email/route.ts:41`), ADMIN_RATE_OVERRIDE (`admin/rates/route.ts:65`), ADMIN_TRANSFER_RETRY (`admin/transfers/[id]/retry/route.ts:25`), ADMIN_TRANSFER_REFUND (`admin/transfers/[id]/refund/route.ts:25`)

**AuthEvent events MISSING:**
- LOGOUT — `auth/logout/route.ts` calls `revokeSession()` but writes no AuthEvent; session deletion is not audited
- EMAIL_CHANGE_COMPLETED — no AuthEvent when the new email is verified and swap completes
- ADMIN_FAILED_EMAIL_RESOLVE — `admin/failed-emails/[id]/resolve/route.ts` writes no AuthEvent; the resolvedBy field on the FailedEmail row is the only attribution

**TransferEvent transitions covered:** All transitions go through `transitionTransfer()` in `state-machine.ts:68`, which atomically writes a TransferEvent on every status change. `cancel.ts:43` and `create.ts:104` each write their own TransferEvent for CANCELLED and CREATED respectively. All 13 defined transitions are covered.

**TransferEvent transitions MISSING:** None — the state machine is the single write path.

## Admin-action audit
- `admin/rates` POST: writes `ADMIN_RATE_OVERRIDE` AuthEvent with actor userId ✓
- `admin/transfers/[id]/retry` POST: writes `ADMIN_TRANSFER_RETRY` AuthEvent with actor userId ✓
- `admin/transfers/[id]/refund` POST: writes `ADMIN_TRANSFER_REFUND` AuthEvent with actor userId ✓
- `admin/failed-emails/[id]/resolve` POST: NO AuthEvent — only sets `resolvedBy` on the FailedEmail row; no immutable audit row in AuthEvent table

## Gaps prioritized

**P0 (regulatory blocker):**
1. THRESHOLD ComplianceReport never created — AUSTRAC requires a TTR for cash (AUD) transfers ≥ $10,000. No threshold constant, no trigger, no write path.
2. IFTI ComplianceReport never created — international fund transfers ≥ $1,000 AUD require IFTI reporting to AUSTRAC. Zero implementation.
3. Daily reconciliation does not pull Monoova or Flutterwave statements — the AUSTRAC reconciliation requirement (diff internal ledger vs provider records) is entirely unimplemented; current worker only manipulates internal rows.

**P1 (correctness):**
4. Velocity check absent — sudden send-frequency spikes are a primary SMR trigger; `compliance/index.ts` is an empty stub.
5. LOGOUT not audited — session revocations are unlogged; 7-year AUSTRAC record retention requires authentication lifecycle events.
6. `admin/failed-emails/resolve` missing AuthEvent — admin actions must be immutably logged with actor identity.

**P2 (nice-to-have):**
7. IP geolocation and device fingerprint checks noted in CLAUDE.md are not implemented — reduces SMR detection surface.
8. EMAIL_CHANGE_COMPLETED AuthEvent missing — email swaps are identity changes; the completion step should be logged.
