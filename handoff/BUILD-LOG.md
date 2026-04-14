# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 1 -- Project Scaffold + Database Schema
**Last cleared:** N/A (first step)
**Pending deploy:** NO (scaffold only, no deployment target yet)

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
