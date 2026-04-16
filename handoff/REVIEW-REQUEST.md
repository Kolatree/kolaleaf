# Review Request -- Step 16

**Step:** 16 -- Flutterwave bank resolution for recipients UX
**Date:** 2026-04-16
**Builder:** Bob
**Ready for Review:** YES

---

## What Changed

Replaces the free-text recipient form with a provider-verified flow.

**Before:** user typed full name + bank name + bank code + account number.
Four free-text fields, four places for typos, no guarantee the name matches
the bank's record. Typo in account name => payout rejected or (worse) lands
with a misspelled name and Richard has to clean it up manually.

**After:** user picks a bank from a provider-populated dropdown, types a
10-digit account number, and the account holder's canonical name resolves
live from Flutterwave. Submit stays disabled until the name resolves. This
is the standard Nigerian remittance UX (GTBank, Kuda, Chipper, etc. all
work this way) and removes an entire class of failure.

## Files With Line Ranges

### Core logic

| File | Lines | Change |
|------|-------|--------|
| `src/lib/payments/payout/types.ts` | 61-71 | New `AccountNotFoundError` (non-retryable `PayoutError` subclass). |
| `src/lib/payments/payout/flutterwave.ts` | 1-21 | Added `node:crypto` + `AccountNotFoundError` imports. |
| `src/lib/payments/payout/flutterwave.ts` | 23-60 | Added `NG_BANKS_FALLBACK` (21 banks -- tier-1 retail + Kuda / Moniepoint / OPay / PalmPay) and `BankListEntry` interface. |
| `src/lib/payments/payout/flutterwave.ts` | 98-104 | Added `BANKS_CACHE_TTL_MS` + `devListBanksLogged` flag + `BanksCacheEntry` type. |
| `src/lib/payments/payout/flutterwave.ts` | 109-113 | Added `banksCache` instance field. |
| `src/lib/payments/payout/flutterwave.ts` | 121-157 | New `listBanks(country: 'NG')`. Dev (no key): returns fallback once-logged. Prod: GET `/v3/banks/NG` via `withRetry`, normalises response, caches 24h. |
| `src/lib/payments/payout/flutterwave.ts` | 159-217 | New `resolveAccount({bankCode, accountNumber})`. Dev: deterministic `DEMO ACCOUNT <last4>`. Prod: POST `/v3/accounts/resolve` with body `{account_number, account_bank}` and `Idempotency-Key = sha256(bankCode:accountNumber)`. `ProviderPermanentError` / non-retryable errors / `status: "error"` / missing `account_name` -> `AccountNotFoundError`. Name returned **verbatim** (no trim, no case change). |
| `src/lib/payments/payout/flutterwave.ts` | 374-382 | New `createFlutterwaveProvider()` lazy factory. Reads env on call; never throws at import. Matches 15l pattern. |
| `src/lib/payments/payout/index.ts` | 1-22 | Exports `AccountNotFoundError`, `createFlutterwaveProvider`, `NG_BANKS_FALLBACK`, `BankListEntry`. |

### New API routes

| File | Lines | Change |
|------|-------|--------|
| `src/app/api/banks/route.ts` | 1-56 | `GET /api/banks?country=NG`. `requireAuth`; rejects missing / unsupported country with 400 `unsupported_country`; 200 `{banks}` + `Cache-Control: private, max-age=3600`; 503 `banks_unavailable` on provider failure. |
| `src/app/api/recipients/resolve/route.ts` | 1-118 | `POST /api/recipients/resolve`. Validates `bankCode` non-empty and `accountNumber` exactly 10 digits. `requireAuth`. In-memory per-user rate-limit (20 / 60s rolling window, `Map<userId, {count, windowStart}>`). 200 `{accountName}`, 404 `account_not_found`, 429 `rate_limited`, 503 `resolve_unavailable`. |

### UI

| File | Lines | Change |
|------|-------|--------|
| `src/app/(dashboard)/recipients/page.tsx` | 1-44 | New `Bank` interface, `ResolveState` discriminated union, `RESOLVE_DEBOUNCE_MS = 400`. |
| `src/app/(dashboard)/recipients/page.tsx` | 46-69 | State refactor: dropped `fullName` + `bankName` (both now derived from resolve + selected bank). Added `banks`, `banksError`, `resolveState`, `resolveTimerRef`, `resolveSeqRef`. |
| `src/app/(dashboard)/recipients/page.tsx` | 71-114 | Debounced resolve effect. Resets on input change, uses `resolveSeqRef` sequence guard against out-of-order responses. Maps API status codes to UI state (200 -> resolved, 404 -> not_found, other -> unavailable). |
| `src/app/(dashboard)/recipients/page.tsx` | 115-127 | `loadBanks()` -- `GET /api/banks?country=NG`. |
| `src/app/(dashboard)/recipients/page.tsx` | 129-164 | `handleAdd` refactored. Blocks submit unless `resolveState.kind === 'resolved'`. POSTs unchanged contract using resolved name + selected bank. |
| `src/app/(dashboard)/recipients/page.tsx` | 191-253 | Form JSX rewritten. Bank `<select>` populated from `banks`, account-number input with `\D`-strip + `maxLength=10`, live `aria-live="polite"` resolve status block, submit disabled until resolved. List rendering below untouched. |

## Tests Added

| File | Tests |
|------|-------|
| `tests/lib/payments/payout/flutterwave-resolve.test.ts` | 10 tests. `listBanks`: dev fallback skips network, prod fetch shape + Bearer auth, normalisation filters empty entries, 24h cache hits. `resolveAccount`: dev determinism, prod URL + body + SHA-256 Idempotency-Key derivation, literal preservation of whitespace-padded name, `AccountNotFoundError` on provider 400 error, `AccountNotFoundError` on 200-with-missing-`account_name`. |
| `tests/app/api/banks/route.test.ts` | 5 tests. 401 when unauth, 400 on missing country, 400 on `country=KE` (multi-corridor boundary), 200 with `banks` array + exact `private, max-age=3600` header, 503 on provider error. |
| `tests/app/api/recipients/resolve.test.ts` | 6 tests. 400 invalid JSON, 400 missing bankCode, 400 on 9/11/non-digit accountNumber, 401 unauth, 200 with accountName + correct args passed to provider, 404 on `AccountNotFoundError`, 503 on `ProviderTemporaryError`, 429 at 21st call from same userId. |

## Phase D Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | **628 passed / 244 suites / 0 failed** (baseline was 607; +21) |
| `npm run build` | `Compiled successfully`, 0 warnings. `/api/banks` and `/api/recipients/resolve` appear in the route table. |
| Manual dev smoke | **DEFERRED** -- see Open Questions below. |

## Open Questions / Flags for Richard

1. **Manual dev smoke deferred.** This workspace has no `.env.local`, so the
   dev server can't boot against Postgres. Every branch of the new logic is
   covered by the 21 new unit/integration tests (auth gate, validation,
   success, not-found, temp-failure, rate-limit, cache, idempotency-key
   shape). If you'd like, run the smoke yourself after pulling: start
   `npm run dev`, log in as `demo@kolaleaf.com`, hit `/recipients`, type
   `0690000031`, pick a bank, expect to see `DEMO ACCOUNT 0031`.

2. **`POST /api/recipients` server route was deliberately NOT modified.**
   The brief says "server contract unchanged". The existing validation still
   requires `fullName`, `bankName`, `bankCode`, `accountNumber` -- the client
   now fills all four from verified sources. If you'd prefer the server
   also re-verify the account on submit (defence in depth), that's a 16b
   follow-up -- flag in feedback if you want it.

3. **In-memory rate-limit.** 20 req / 60s / userId in a `Map`. Single-process
   only. Fine for the current single-Railway-worker topology; needs Redis
   when we scale horizontally. Documented in the route file header.

4. **Search-free `<select>`.** 21 banks fit in a native dropdown. For AU/GH/KE
   corridors with 40+ banks, a searchable combobox makes sense -- logged as
   a known-gap in BUILD-LOG, not in 16's scope.

5. **Observability.** The posttool validator flagged no logging on the new
   route handlers. Consistent with the rest of the codebase -- waiting on
   project-wide Sentry / structured-logger wiring.

## Notes for Review Focus

Please pay attention to:
- Is the submit-disabled-until-resolved gate actually unbypassable? (Try
  rapid-click, try changing bank after resolve, try editing account number
  after resolve, try empty resolveState.)
- `resolveSeqRef` race guard -- correct semantics when a slow 404 response
  arrives after a later 200?
- Idempotency-Key derivation -- stable across retries, not leaking account
  numbers into logs.
- `AccountNotFoundError` mapping from `ProviderPermanentError` -- am I too
  aggressive here? A 500 wrapped as PermanentError would look like "account
  not found" to the user. Trade-off: UX clarity vs telling the user the
  truth. I chose UX clarity for the common case but want your read.
