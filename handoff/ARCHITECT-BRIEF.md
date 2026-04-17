# Architect Brief — Step 18: Verify-First Registration (3-step wizard)
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Replace the current one-shot register flow with a three-step wizard that
verifies the email **before** any `User` row is created. This prevents the
DB from accumulating unverified ghost rows and tightens the AUSTRAC
posture — every persisted customer has demonstrably controlled an email
account at the moment of account creation.

Product Owner rationale (direct quote):
> "This is important so we don't fill the database with unverified emails."

---

## Target Flow

```
/register              email input                   POST /api/auth/send-code
  ↓  (200 ok; code sent)
/register/verify       6-digit code input            POST /api/auth/verify-code
  ↓  (200 verified; claim window opens for 30 min)
/register/details      fullName + AU address + pw    POST /api/auth/complete-registration
  ↓  (201 + Set-Cookie; User + Identifier[verified] + Session)
/kyc                   "Verify identity" | "Skip"    (KYC is skippable at this stage)
  ↓  skip
/send                  user lands in the app
```

**Hard KYC block stays where it already belongs:** at transfer creation
(`KYC gates PayID` per CLAUDE.md). This brief does NOT re-implement that —
audit is a separate task after this wave.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Address scope | **AU-only for v1.** International is post-launch. |
| Wizard UX | **Three URL-routed pages.** Each step is re-entrant on reload; back button works. |
| KYC gate | **Prompt at /kyc after registration (skippable). Hard block at first transfer (existing).** |
| Legacy `/api/auth/register` | **Delete the route** — Next will serve 404. |
| Existing unverified test users in prod | **Delete post-deploy.** Only 2 rows; they're test data. |
| Claim window (step 2 → step 3) | **30 minutes.** Matches the code TTL we already use. |

---

## Schema Changes

### New model — `PendingEmailVerification`

No FK to `User` because there is no User yet when this row exists. After
step 3 completes, the row is deleted. The existing `EmailVerificationToken`
model stays for *logged-in* users verifying a secondary email (change-email
flow).

```prisma
model PendingEmailVerification {
  id             String    @id @default(cuid())
  email          String    @unique
  codeHash       String
  expiresAt      DateTime
  attempts       Int       @default(0)
  verifiedAt     DateTime?            // set when step 2 succeeds
  claimExpiresAt DateTime?            // step 3 must complete before this
  createdAt      DateTime  @default(now())

  @@index([expiresAt])
}
```

### New fields on `User` (AU-only, nullable)

Migration stays backfill-safe. The 2 existing test users become
grandfathered (Arch deletes them manually after deploy).

```prisma
addressLine1 String?
addressLine2 String?
city         String?
state        String?          // validated at endpoint: NSW|VIC|QLD|WA|SA|TAS|ACT|NT
postcode     String?          // 4 digits, validated at endpoint
country      String?          // "AU" for all v1 users
```

---

## New Endpoints

### `POST /api/auth/send-code { email }`
- Normalize email: trim + lowercase
- Reject malformed email with 400 (must contain `@`)
- Rate limit: ≤ 5 `PendingEmailVerification` creations per email per hour
- If the email is already owned by a verified `UserIdentifier`:
  - **Do NOT send a code.** Silently return 200 — enumeration-proof.
- Otherwise: upsert `PendingEmailVerification` row with fresh codeHash,
  attempts=0, expiresAt = now + 30min, clear verifiedAt + claimExpiresAt.
- Send email via existing `sendEmail` + `renderVerificationEmail`.
- **ALWAYS return 200 `{ ok: true }`** regardless of branch. No enumeration.

### `POST /api/auth/verify-code { email, code }`
- Normalize email
- Reject if code !~ `/^\d{6}$/` (400)
- Find `PendingEmailVerification` by email. Error shape matches
  `verifyEmailWithCode` today:
  - `no_token` → 400
  - `expired` (past `expiresAt`) → 400
  - `used` (already verified AND `claimExpiresAt` past) → 400
  - `too_many_attempts` (attempts ≥ 5) → 429 + burn token
  - `wrong_code` → 400 + increment attempts
- Success: set `verifiedAt = now`, `claimExpiresAt = now + 30min`.
  Return 200 `{ verified: true }`. **NO session cookie.**

### `POST /api/auth/complete-registration { email, fullName, password, addressLine1, addressLine2?, city, state, postcode }`
- Normalize email
- Look up `PendingEmailVerification`. Reject 400 if:
  - Row missing
  - `verifiedAt === null`
  - `claimExpiresAt < now`
- Validate every field:
  - `fullName`: non-empty after trim, ≥ 2 chars
  - `password`: via existing `validatePasswordComplexity`
  - `addressLine1`: non-empty, ≥ 3 chars
  - `addressLine2`: string if present, optional
  - `city`: non-empty
  - `state`: one of NSW|VIC|QLD|WA|SA|TAS|ACT|NT
  - `postcode`: `/^\d{4}$/`
- Transaction (`prisma.$transaction`):
  1. Guard: no existing verified `UserIdentifier` for this email → else 409
  2. Create `User` (passwordHash + address fields + `country: "AU"`)
  3. Create `UserIdentifier { type: EMAIL, identifier: email, verified: true, verifiedAt: now }`
  4. Create `Session` via existing `createSession`
  5. Delete the `PendingEmailVerification` row
  6. Write `AuthEvent { event: "REGISTRATION", userId, metadata: { via: "verify-first" } }`
  7. Write `AuthEvent { event: "LOGIN", userId, metadata: { via: "email-verification" } }`
- Set session cookie via existing `setSessionCookie`.
- Return 201 `{ user: { id, fullName } }`.

### `POST /api/auth/register` (legacy)
- **Delete** the route handler entirely. Next will serve 404.
- Delete the matching test file.

### `/api/auth/resend-verification` (unchanged)
- Keep as-is. Used only by the login→verify-email path for legacy
  logged-in-but-unverified users. The new /register/verify page calls
  `/api/auth/send-code` directly.

---

## Frontend (three pages + /kyc)

### `/register` — step 1 (email only) — REPLACES existing register page
- Single email input + "Send code" button.
- On 200: `router.push(\`/register/verify?email=${encodeURIComponent(email)}\`)`.
- Variant D card + gradient consistent with login page.

### `/register/verify` — step 2 (code entry) — NEW page
- Adapt from existing `/verify-email` page layout.
- `?email=` read via `useSearchParams` (wrap in `Suspense`, Next 16 requires).
- 6-digit numeric input + "Verify" + "Resend code" (calls /send-code).
- On 200: `router.push(\`/register/details?email=${encodeURIComponent(email)}\`)`.

### `/register/details` — step 3 (name + AU address + password) — NEW page
- `?email=` displayed read-only with an "Edit" link back to /register.
- Fields:
  - Full name — placeholder: "As it appears on your ID document"
  - Address line 1
  - Address line 2 (optional)
  - Suburb/City
  - State — native `<select>` with AU states
  - Postcode — inputMode="numeric", maxLength 4, pattern `\d{4}`
  - Country — non-editable "Australia" display
  - Password — reuse existing placeholder + complexity hints
- On 201: `router.push('/kyc')`.

### `/kyc` — post-registration gate — NEW page
- Headline "Verify your identity"
- Body copy (AUSTRAC, ~2 min).
- "Verify identity now" → POST `/api/kyc/initiate` → redirect to returned Sumsub URL.
- "Skip for now" link → `router.push('/send')`.
- Do NOT reimplement Sumsub flow; backend route exists.

### Existing `/verify-email` page
- Keep as-is for the legacy login→unverified path.

---

## Test Strategy (TDD — tests first)

### Unit — new `src/lib/auth/pending-email-verification.ts`
- `issuePendingEmailCode({ email })` — upsert + send
- `verifyPendingEmailCode({ email, code })` — returns `{ verified: true }` on success, same error shape as `verifyEmailWithCode`
- Rate limit + attempt cap tests carry over

### Route tests (mock prisma)
- `send-code.test.ts`: always 200; silently no-ops for verified-email; creates row + sends for new
- `verify-code.test.ts`: no_token / expired / used / too_many / wrong_code / success. Success returns `{ verified: true }` with NO Set-Cookie.
- `complete-registration.test.ts`:
  - 400 if claim missing / unverified / expired
  - 400 for each bad field
  - 409 if email already owned by verified user (race)
  - 201 + Set-Cookie on success
  - Creates User with address, UserIdentifier verified=true, Session, both AuthEvents, deletes PendingEmailVerification

### E2E
- `tests/e2e/register-wizard.test.ts` (new):
  - send-code → read the code from a spy on `sendEmail` (or by mocking `generateVerificationCode`) → verify-code → complete-registration → session valid against `/api/account/me`
- Update `tests/e2e/auth-lifecycle.test.ts` and `transfer-lifecycle.test.ts` only if failing — they operate at service layer, not route, so no change expected.

### Test count expectation
Current: 655 tests pass.
Target: 655 - 7 (deleted register route tests) + ~25 new ≈ 673+.

---

## Build Order (for Bob)

1. Schema: add `PendingEmailVerification` + nullable address fields on `User`. Generate migration + Prisma client.
2. Helper: `src/lib/auth/pending-email-verification.ts` with unit tests first.
3. Endpoint: `send-code` + tests (TDD).
4. Endpoint: `verify-code` + tests (TDD).
5. Endpoint: `complete-registration` + tests (TDD).
6. Delete `src/app/api/auth/register/route.ts` + `tests/app/api/auth/register.test.ts`.
7. Frontend: rewrite `/register/page.tsx` (email only).
8. Frontend: new `/register/verify/page.tsx`.
9. Frontend: new `/register/details/page.tsx`.
10. Frontend: new `/kyc/page.tsx`.
11. Full validation: `npm test -- --run` all green; `npx tsc --noEmit` clean; `rm -rf .next && npm run build` succeeds.
12. Append done-block to `handoff/BUILD-LOG.md`.
13. Write `handoff/REVIEW-REQUEST.md`: one paragraph summary + full list of changed/added/deleted files + any deliberate design calls.
14. Signal done. Arch will handle production migration + deploy.

---

## Constraints & Non-Negotiables

- **TDD**: failing test before implementation for every endpoint and helper.
- **No enumeration leaks**: `/send-code` always 200 regardless of email state; `/verify-code` errors never distinguish user state.
- **No breaking changes to login or the logged-in change-email flow.** Both keep using `EmailVerificationToken`.
- **AuthEvent audit trail preserved**: REGISTRATION + LOGIN on success.
- **Rate limits + attempt caps carry forward**: 5 sends/hour/email, 5 attempts/token, 30-min TTL.
- **No session issued until `/complete-registration` succeeds.**
- **Password policy unchanged** (8+ chars, 3 of 4 classes).
- **Address stored as typed columns**, not JSONB.
- **Country = "AU"** for all v1 users.

---

## Explicitly Out of Scope

- KYC hard-block at transfer creation (audit existing; separate task).
- International address support.
- Migrating/backfilling the 2 existing test users.
- Account page user display (existing gap).
- Observability instrumentation beyond current baseline.
- Renaming `EmailVerificationToken` — keep both models side by side.

---

## Done Criteria

- Tests: 680+ pass; `npx tsc --noEmit` clean; `npm run build` succeeds.
- Dev curl path succeeds end-to-end:
  1. POST /api/auth/send-code → 200
  2. POST /api/auth/verify-code with code → 200 `{ verified: true }`
  3. POST /api/auth/complete-registration → 201 + Set-Cookie
  4. GET /api/account/me with cookie → user row + address fields populated
- DB inspection: `User` row created with address, `UserIdentifier` verified=true, `PendingEmailVerification` deleted, two AuthEvents logged.
- `/api/auth/register` (old) → 404.
- `handoff/REVIEW-REQUEST.md` written.
