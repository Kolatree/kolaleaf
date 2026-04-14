# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 9 -- API Routes + Pages (Full Stack)
**Last cleared:** Step 8
**Pending deploy:** NO

---

## Step History

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

None.

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Prisma 7 with adapter pattern (PrismaPg) for database connectivity -- 2026-04-14
- cuid() for all primary keys (URL-safe, sortable) -- 2026-04-14
- @db.Decimal for all money amounts, never float -- 2026-04-14
- Cascade delete on UserIdentifier and Session only; no cascade on Transfer or Recipient -- 2026-04-14
- @@unique([baseCurrency, targetCurrency]) on Corridor for multi-corridor support -- 2026-04-14
