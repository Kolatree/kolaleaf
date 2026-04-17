# Review Feedback — Step 20
*Written by Richard (via critic agent, transcribed by Arch — critic has no Write tool).*

## Verdict

- [x] APPROVE WITH MINOR CHANGES

---

## Blocking findings

### B1: `DecimalString` allows negative values — comment and behaviour contradict each other
**Location:** `src/lib/schemas/common.ts:62`
**Category:** Bug — incorrect validation on money fields

The inline comment reads "Negative / NaN rejected" but the regex is `/^-?\d+(\.\d+)?$/` — the `-?` makes a leading minus optional, so `-100` or `-0.5` parses successfully. Any route using `DecimalString` for `sendAmount`, `customerRate`, or `wholesaleRate` passes a negative string into `new Decimal(...)` and on to the DB.

**Fix:** drop `-?` from the regex → `/^\d+(\.\d+)?$/`. Add a test case for the negative rejection.

### B2: `POST /transfers` runs `parseBody` BEFORE auth — 422 leaks endpoint existence/shape to unauthenticated callers
**Location:** `src/app/api/v1/transfers/route.ts:9–19`
**Category:** Security / consistency

`parseBody` runs on line 9 before `requireEmailVerified`/`requireKyc` on lines 17-18. An unauthenticated caller with a malformed body gets 422 + field hints, leaking that the endpoint exists and its body shape, rather than a 401.

The project's own convention (visible in `admin/rates/route.ts:52`) is: **auth first, parse body second**.

**Fix:** move auth gate above `parseBody` in `transfers/route.ts` (and any other route with the same ordering — Arch must grep before fixing).

---

## Non-blocking findings

### N1: Scientific notation passes `DecimalString` correctly via deterministic JS stringification
Worth a 1-line comment noting that `String(v)` coercion is deterministic for the `z.number()` path. Not required.

### N2: `BanksQuery` uses `z.literal('NG')` — over-constrained for multi-corridor future
**Location:** `src/app/api/v1/banks/_schemas.ts:8`
Acceptable today (AU-NGN only). Flag for whoever picks up the next-corridor step.

### N3: `auth/logout` `_schemas.ts` doesn't document 401
**Location:** `src/app/api/v1/auth/logout/_schemas.ts:10–25`
OpenAPI completeness only; no runtime defect.

### N4: `tests/e2e/openapi-endpoint.test.ts:48` asserts `>= 41`, not `=== 41`
**Fix:** `toBeGreaterThanOrEqual(41)` → `toBe(41)`. Gates on exact contract; catches accidental double-registration.

---

## Bob's flagged decisions

**1. Zod 4.3.6 — Accept.** Generator pinned `zod ^4.0.0`, Zod 4 moved to `latest`, and all reviewed usage (`z.object`, `safeParse`, `flatten`, `flattenError` in `zod-error.ts:13`) is correct.

**2. No `parseBody` on bodyless POSTs — Accept with caveat.** Correct in spirit; `_schemas.ts` files register response types for OpenAPI only. Caveat lives in B2: body-accepting routes must still run auth before `parseBody`.

**3. Test count 792 vs ~834 — Accept.** Shortfall comes from GET/DELETE and bodyless POST routes with no meaningful schema-violation cases. The body-accepting endpoint coverage is solid; no padding needed.

---

## Positives

- `IdempotentOpenAPIRegistry` subclass with `seen` Set handles hot-reload + Vitest isolation cleanly.
- `admin/rates/route.ts:48-52` has the correct auth-before-parse ordering and a comment explaining why. That comment should be the template for `transfers/route.ts` (see B2).
- `Email`: `.trim().toLowerCase().email()` — normalises before validating.
- 41-count triple-verified: `find -name _schemas.ts | wc -l` = 41, openapi side-effect imports = 41 lines, `jq '.paths | keys | length'` = 41. Barrel + import list in sync.
- `DecimalString` dual-input (`string | number`) with single normalised output is the right API for Prisma Decimal fields.

---

**Summary:** Two blocking fixes (B1 data-integrity + B2 auth ordering) + one test tightening (N4). Everything else ship-quality.
