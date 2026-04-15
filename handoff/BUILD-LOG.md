# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 14 -- UI→Backend Gap Closure (review pending)
**Last cleared:** Step 13
**Pending deploy:** NO

---

## Step History

### Step 14 -- UI→Backend Gap Closure -- REVIEW PENDING
*Date: 2026-04-15*

Closes 3 gaps the Variant D redesign introduced (audit by Bob, scope confirmed by Arch).

Files changed:
- `src/app/api/rates/public/route.ts` (NEW) -- public read-only rate endpoint, pair-based query, 60s/120s SWR cache, no admin field leak
- `tests/app/api/rates/public.test.ts` (NEW) -- 8 cases covering 400, 404, success shape, PII filter, cache header, case normalization
- `src/lib/transfers/queries.ts` -- enrich `listTransfers` with `recipient: { id, fullName, bankName }`; new exported `TransferListRecipient` and `TransferWithRecipient` types
- `tests/lib/transfers/queries.test.ts` -- new test for the recipient enrichment + sensitive-field omission
- `src/app/(dashboard)/send/page.tsx` -- swap `/api/rates/aud-ngn` → `/api/rates/public?base=AUD&target=NGN`
- `src/app/_components/landing-page.tsx` -- same swap + comment update

Decisions:
- Generic pair-based public endpoint (consistent with multi-corridor invariant), not slug-based
- Send page uses the same public endpoint (no separate authed variant in this step)
- `TransferWithRecipient.recipient` typed nullable for safety
- Pre-existing `/api/rates/[corridorId]` left in place; no callers but no harm

Verification:
- `npx tsc --noEmit` -- 0 errors (cleaner than baseline of 4)
- `npm test -- --run` -- ~382 pass, 4 known-flaky failures (matches HANDOVER baseline)
- `tests/app/api/rates/public.test.ts` in isolation -- 8/8 pass

Reviewer findings: [pending Richard]
Deploy: pending Step 15 holistic review

---

### Step 1 -- Project Scaffold + Database Schema -- REVIEW PENDING
*Date: 2026-04-14*

Files changed:
- `.gitignore` -- git ignore rules
- `package.json` -- project config, scripts, dependencies
- `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs` -- Next.js 15 scaffold config
- `vitest.config.ts` -- test runner config
- `prisma.config.ts` -- Prisma 7 config (datasource URL, seed command)
- `prisma/schema.prisma` -- full schema (12 models, 7 enums)
- `prisma/seed.ts` -- AUD-NGN corridor + test rate seed
- `prisma/migrations/20260414042514_init/` -- initial migration
- `src/lib/db/client.ts` -- Prisma client singleton
- `src/lib/{transfers,payments,kyc,auth,rates,compliance}/index.ts` -- placeholder modules
- `tests/lib/db/foundation.test.ts` -- 6 foundation tests
- `.env` -- local DATABASE_URL (port 5433)

Decisions made:
- Prisma 7.7.0 requires adapter-based client (PrismaPg from @prisma/adapter-pg) instead of classic PrismaClient
- Docker Postgres on port 5433 (5432 occupied by existing porizo-postgres container)
- Generated Prisma client gitignored, regenerated via postinstall hook
- Used `prisma-client` generator (Prisma 7 default) instead of deprecated `prisma-client-js`

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 9 -- API Routes + Pages (Full Stack) -- REVIEW PENDING
*Date: 2026-04-14*

Files changed:
- `src/lib/auth/middleware.ts` -- auth middleware (cookie parsing, session validation, requireAuth/requireKyc)
- `src/app/api/auth/{register,login,logout,verify-2fa}/route.ts` -- auth API routes
- `src/app/api/transfers/route.ts`, `[id]/route.ts`, `[id]/cancel/route.ts` -- transfer CRUD + cancel
- `src/app/api/recipients/route.ts`, `[id]/route.ts` -- recipient CRUD + delete
- `src/app/api/webhooks/{monoova,flutterwave,paystack,sumsub}/route.ts` -- webhook handlers (raw body)
- `src/app/api/kyc/{initiate,status}/route.ts` -- KYC endpoints
- `src/app/api/rates/[corridorId]/route.ts` -- public rate endpoint
- `src/app/(auth)/layout.tsx`, `login/page.tsx`, `register/page.tsx` -- auth pages
- `src/app/(dashboard)/layout.tsx`, `_components/bottom-nav.tsx` -- dashboard shell
- `src/app/(dashboard)/{send,activity,recipients,account}/page.tsx` -- 4 dashboard pages
- `src/app/globals.css` -- Kolaleaf theme colors (purple-to-green gradient)
- `src/app/layout.tsx`, `src/app/page.tsx` -- branding + redirect to /send
- `tests/lib/auth/middleware.test.ts` -- 7 auth middleware tests
- `tests/app/api/auth/{register,login}.test.ts` -- 11 auth route tests
- `tests/app/api/webhooks/monoova.test.ts` -- 4 webhook tests
- `tests/app/api/rates/corridor.test.ts` -- 2 rate tests
- All `src/lib/**/*.ts` -- stripped .js import extensions for Turbopack compatibility
- `src/lib/payments/payout/webhooks.ts`, `flutterwave.ts` -- type fixes for Prisma Json + unknown
- `src/lib/transfers/state-machine.ts` -- metadata cast for Prisma Json type

Decisions made:
- Custom cookie-based auth (kolaleaf_session, HttpOnly, SameSite=Lax, Max-Age=900)
- Webhook routes use request.text() for raw body signature verification
- Dashboard layout does server-side session check, redirects to /login if unauthenticated
- Send page polls rates every 60s with Decimal.js math
- Cleaned .js extensions from all TS imports (Turbopack doesn't resolve .ts → .js)

Reviewer findings: [pending review]
Deploy: N/A

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

Logged during Step 14 audit (deferred per brief):
- `/activity/[id]` -- transfer detail page referenced by Activity row links, not yet implemented
- `/privacy`, `/terms`, `/compliance-info` -- footer stub links (404 today)
- Mobile hamburger menu in `SiteHeader` (current mobile fallback is "Sign in / Start sending" only)
- Login rate limiting (no protection against brute force)
- Account page user name/email display (not requested in any brief; nice-to-have)
- Test flakiness in `tests/lib/transfers/queries.test.ts` (4 tests fail under `afterEach` cleanup race; pre-existing, not introduced by Step 14)
- Pre-existing `/api/rates/[corridorId]` route is now unused by any UI -- remove in a future cleanup step
- 4 pre-existing TS errors in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` (runtime-safe per HANDOVER) -- now showing as 0 in tsc, may need re-check

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Prisma 7 with adapter pattern (PrismaPg) for database connectivity -- 2026-04-14
- cuid() for all primary keys (URL-safe, sortable) -- 2026-04-14
- @db.Decimal for all money amounts, never float -- 2026-04-14
- Cascade delete on UserIdentifier and Session only; no cascade on Transfer or Recipient -- 2026-04-14
- @@unique([baseCurrency, targetCurrency]) on Corridor for multi-corridor support -- 2026-04-14
