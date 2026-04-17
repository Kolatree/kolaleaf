# Review Request — Step 19: `/api/v1` Versioning
*Written by Bob. Read by Richard.*

---

## Summary

Every client-facing API route moved under `/api/v1/`. All in-repo callers
rewired through a new single-source HTTP client `apiFetch`. Webhooks and
cron endpoints stay on `/api/*` (provider/Railway URL ownership). The
`/api/auth/register` 410 stub is preserved at its legacy path per brief.

**Before:** 698 tests passing.
**After:** 706 tests passing (+4 api-client unit tests, +4 versioning
smoke tests — matches the brief's 698 + 4 + 4 prediction).

---

## Files added (3)

| Path | Purpose |
|---|---|
| `src/lib/http/api-client.ts` | Exports `API_V1 = '/api/v1'` and `apiFetch(path, init)`. Wraps `fetchWithTimeout`, strips defensive leading `/`, preserves `timeoutMs`. |
| `tests/lib/http/api-client.test.ts` | 4 unit tests (prefix, leading-slash tolerance, method/headers/body passthrough, timeout abort). |
| `tests/e2e/versioning-smoke.test.ts` | 4 smoke tests (v1 send-code 200, legacy send-code module absent, auth/register 410 stub, webhook still at legacy path). |

## Files moved (42 route files, grouped by area)

All moves were a single directory rename per area:

| Source (legacy) | Destination (v1) | Routes |
|---|---|---|
| `src/app/api/auth/*` → `src/app/api/v1/auth/*` | — | 10 (login, logout, send-code, verify-code, verify-2fa, verify-email, complete-registration, resend-verification, request-password-reset, reset-password) |
| `src/app/api/account/*` → `src/app/api/v1/account/*` | — | 11 (me, change-password, change-email, email/[id], phone/{add,verify,remove}, 2fa/{setup,enable,disable,regenerate-backup-codes}) |
| `src/app/api/admin/*` → `src/app/api/v1/admin/*` | — | 9 (stats, float, rates, compliance, transfers, transfers/[id], transfers/[id]/retry, transfers/[id]/refund, referrals/[id]/pay) |
| `src/app/api/transfers/*` → `src/app/api/v1/transfers/*` | — | 3 (root, [id], [id]/cancel) |
| `src/app/api/recipients/*` → `src/app/api/v1/recipients/*` | — | 3 (root, [id], resolve) |
| `src/app/api/rates/*` → `src/app/api/v1/rates/*` | — | 2 (public, [corridorId]) |
| `src/app/api/kyc/*` → `src/app/api/v1/kyc/*` | — | 2 (status, initiate) |
| `src/app/api/banks/*` → `src/app/api/v1/banks/*` | — | 1 |

Then `src/app/api/v1/auth/register` was restored at `src/app/api/auth/register`
(the 410 stub) per brief — Nothing else remains under `src/app/api/auth/`.

**Totals:** 41 route files under `src/app/api/v1/**` + 1 preserved 410
stub at legacy path = 42 routes covered.

**Untouched:** `src/app/api/webhooks/*` (4 routes), `src/app/api/cron/*`
(5 routes).

## Tests moved (22 files)

All `tests/app/api/<area>/*` moved to `tests/app/api/v1/<area>/*`:
- `rates/` (corridor, public)
- `auth/` (login, verify-email, resend-verification, request-password-reset, reset-password, send-code, verify-code, complete-registration)
- `account/` (change-password, change-email, email-remove, phone/{add,verify,remove}, 2fa/{setup,enable,disable,regenerate-backup-codes})
- `banks/` (route)
- `recipients/` (resolve)

`tests/app/api/webhooks/monoova.test.ts` left in place. No `register.test.ts`
exists (deleted in Step 18). Inside moved files, URL strings globally
replaced `/api/<area>` → `/api/v1/<area>`.

## Files modified (18)

### Wizard hook
- `src/lib/hooks/use-wizard-submit.ts` — swapped `fetchWithTimeout` for `apiFetch`.

### Wizard pages (tail paths)
- `src/app/(auth)/register/page.tsx` — `'auth/send-code'`.
- `src/app/(auth)/register/verify/page.tsx` — `'auth/verify-code'`, `'auth/send-code'`.
- `src/app/(auth)/register/details/page.tsx` — `'auth/complete-registration'`.
- `src/app/(auth)/verify-email/page.tsx` — `'auth/verify-email'`, `'auth/resend-verification'`.
- `src/app/(dashboard)/kyc/page.tsx` — `'kyc/initiate'`.

### Dashboard pages
- `src/app/_components/landing-page.tsx` — `apiFetch('rates/public?…')`.
- `src/app/(auth)/login/page.tsx` — `apiFetch` for login + verify-2fa.
- `src/app/(dashboard)/activity/page.tsx` — `apiFetch('transfers')`.
- `src/app/(dashboard)/activity/[id]/_components/cancel-transfer-button.tsx` — `apiFetch('transfers/…/cancel')`.
- `src/app/(dashboard)/recipients/page.tsx` — 5 calls.
- `src/app/(dashboard)/account/page.tsx` — 3 calls (kyc/status, auth/logout, kyc/initiate).
- `src/app/(dashboard)/account/_components/account-identity-section.tsx` — 4 calls (me, change-password, change-email, email/[id] DELETE).
- `src/app/(dashboard)/account/_components/two-factor-section.tsx` — 6 calls (me×2, 2fa/{setup,enable,disable,regenerate-backup-codes}).
- `src/app/(dashboard)/send/page.tsx` — 4 calls (rates/public, recipients, kyc/status, transfers).

### Admin
- `src/app/admin/page.tsx` — `fetchAdminJson` refactored: still server-side
  (needs `NEXT_PUBLIC_BASE_URL` + forwarded cookie header), but now sources
  the version prefix from `API_V1` and accepts tail paths. Call sites
  updated to `'admin/stats'`, `'admin/float'`, `'admin/rates'`.
- `src/app/admin/rates/page.tsx` — client-side `apiFetch('admin/rates')`.
- `src/app/admin/transfers/page.tsx` — `apiFetch(\`admin/transfers?…\`)`.
- `src/app/admin/compliance/page.tsx` — `apiFetch(\`admin/compliance?…\`)`.
- `src/app/admin/transfers/[id]/page.tsx` — 3 calls (detail, retry, refund).

### Tests
- `tests/app/admin/page.test.tsx` — URL matchers updated from `'/api/admin/stats'` → `'/api/v1/admin/stats'` (and float).
- `tests/e2e/register-wizard.test.ts` — route imports updated to `@/app/api/v1/auth/*`; synthetic URL strings updated.
- `tests/e2e/phone-verification.test.ts` — route imports updated to `@/app/api/v1/account/phone/*`; synthetic URL strings updated.
- `tests/security/admin-security.test.ts` — synthetic URL `/api/admin/test` → `/api/v1/admin/test`.
- All 22 moved `tests/app/api/v1/**/*.test.ts` — global replace `/api/<area>` → `/api/v1/<area>` in URLs and module imports.

## Files deleted

None.

## Decisions made (not explicit in brief)

1. **Server-side `fetchAdminJson` kept as a thin wrapper over `fetch`
   (not `apiFetch`).** Reason: `apiFetch` uses relative URLs, which
   don't resolve in RSC without a base URL. I preserved the existing
   absolute-URL + cookie-forwarding pattern (unchanged behaviour) and
   instead sourced the version prefix from the new `API_V1` constant.
   This gives the brief's "one HTTP client, one prefix" outcome without
   breaking the server-component fetch pattern. If Arch wants stricter
   parity (e.g. a thin `apiFetchServer(path, init)` helper in
   `api-client.ts`), that's a trivial follow-up.

2. **`versioning-smoke.test.ts` uses `import(variable)` for intentionally
   absent paths.** `await import('@/app/api/auth/send-code/route')` is
   statically resolved by tsc and fails the type-check because the
   module no longer exists (the whole point of the test). Assigning the
   path to a `const legacyPath = '…'` first defers resolution to
   runtime — the runtime behaviour (rejection) is what we're asserting.

3. **Comment-only references to legacy paths in
   `src/app/(dashboard)/account/_components/account-identity-section.tsx`
   (line 11: `/api/account/me`) and
   `src/app/(auth)/register/details/page.tsx` (line 21:
   `/api/auth/complete-registration`) were NOT updated.** Scope
   discipline — the brief specifies caller rewrites, not doc comments.
   Happy to refresh if Richard wants.

## Verification output

### Full test run
```
Test Files  92 passed (92)
      Tests  706 passed (706)
   Duration  53.40s
```

### Type check
```
$ rm -rf .next && npx tsc --noEmit
TypeScript compilation completed
```
(0 errors.)

### Production build
```
$ rm -rf .next && npm run build
✓ Compiled successfully in 3.0s
✓ Generating static pages using 11 workers (63/63) in 354ms
```
Build output lists all 41 `/api/v1/**` route files, 4 `/api/webhooks/*`
routes, 5 `/api/cron/*` routes, and `/api/auth/register` (the 410 stub).

### Grep evidence

No in-repo fetch call sites reference a non-v1 `/api/` path:
```
$ tldr search "fetch\(['\"`]/api/" src
[]
```

Only documented exceptions remain under `src/`:
```
$ tldr search "'/api/[^v']" src
[ "app/api/auth/register/route.ts:13: migrate_to: '/api/auth/send-code'" ]
```
(The 410 stub's migration hint — intentional.)

Inside `tests/`:
```
$ tldr search "'/api/[^v']" tests
[]
```
Zero hits outside the versioning-smoke test's deliberate absence checks.

### Local curl smoke (dev server)

```
v1 send-code         POST /api/v1/auth/send-code     → 200
legacy login (gone)  GET  /api/auth/login            → 404
legacy register stub POST /api/auth/register         → 410
webhook wired        GET  /api/webhooks/monoova      → 405
```
All four match the brief's expectations (`405` vs the brief's `401/405`
note for the webhook — GET is unrouted on the webhook POST handler, so
Next returns 405 "Method Not Allowed" before signature validation runs).

## Questions for Arch

None. The brief was precise enough to execute without ambiguity.
