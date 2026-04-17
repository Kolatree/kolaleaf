# Architect Brief — Step 25: Legacy Test-User Cleanup
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

**⚠ This brief has one unresolved policy question for the Product Owner/Arch. Bob must NOT execute until §Policy Decision is marked resolved.**

---

## Goal

Remove (or neutralise) the small set of pre-wizard test `User` rows
identified by `addressLine1 IS NULL AND UserIdentifier.verified = false`
so the live DB no longer contains rows that fail the Step-18 posture
("every persisted customer provably controlled their email at account
creation").

Volume: ~2 rows per Step-18 brief.

---

## Policy Decision — REQUIRED before Bob executes

The tension:
- **Product Owner (Step 18 brief):** "Delete post-deploy. Only 2 rows; they're test data."
- **CLAUDE.md + AUSTRAC:** "`transfer_events` is the immutable audit log. **Never delete rows from this table.**" `AuthEvent` has `onDelete: Restrict` — it cannot be cascaded.
- **AUSTRAC retention:** 7 years for AML/CTF records of customer activity.

Three options, each is a coherent answer. **Arch picks one before Bob
runs anything.**

### Option A — Hard delete (product-owner literal read)

Delete the User rows AND cascade/clean all children, including `AuthEvent`.
Requires FK change: `AuthEvent.user_id` → `onDelete: Cascade` OR a pre-delete
`DELETE FROM auth_events WHERE user_id = ?`. **Violates the CLAUDE.md
"never delete from audit log" rule as written.** Fastest to implement.

Precondition: explicit written authorisation from the Product Owner that
test-user AuthEvents are exempt from 7-year retention. Without that
written trail, AUSTRAC exposure.

### Option B — Soft delete + filter (RECOMMENDED default)

Add a `deletedAt DateTime?` column to `User`. Set it on the target rows.
All queries filter `WHERE deletedAt IS NULL`. AuthEvent chain preserved
intact. Product-owner concern (rows not surfacing in app queries) is
satisfied. Smallest code change per row. Reversible.

### Option C — Anonymise, keep the row

Preserve the `User` row and the AuthEvent chain. Replace PII in-place:
- `fullName` → `'[deleted]'`
- `passwordHash` → NULL
- `addressLine1..2`, `city`, `postcode`, `state` → NULL
- All linked `UserIdentifier` rows → DELETE (unverified identifiers
  have no retention requirement; verified ones would mean we're not
  dealing with "test data" anyway — abort in that case)
- `Session` rows → DELETE (ephemeral)
- Add a `state: 'ANONYMISED'` marker if User gets a lifecycle enum
  (future Pile C step)

Slightly more invasive than Option B. Future-proof if GDPR-style
right-to-be-forgotten lands.

**Arch: pick A / B / C and write the choice into this file under
§Policy Decision Resolved, then Bob proceeds.**

---

## Policy Decision Resolved

**Decision: Option B — soft delete via `User.deletedAt`.**

Rationale: preserves the `AuthEvent` audit chain intact (no cascade
of Restrict FK, no AUSTRAC exposure), smallest code change per
deleted row, fully reversible, and satisfies the product-owner
concern that the rows "don't show up" via the Prisma extension
query filter. Signoff: abcobimma@gmail.com, 2026-04-17.

**STATUS: RESOLVED. Bob may execute.**

---

## Scope (assuming Option B)

If a different option is picked, Bob re-reads §Option A / §Option C and
adapts the scope list below.

### Schema change
```prisma
model User {
  // ...
  deletedAt DateTime?  // soft-delete marker
  // ...
  @@index([deletedAt])  // partial-index alternative if supported
}
```

### Migration
```sql
ALTER TABLE "User" ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "User_deletedAt_idx" ON "User"("deleted_at");
```

### Code changes — global query filter

Two options for applying the filter everywhere it matters:
1. **Prisma middleware / extension** — `$extends` with a `user.findMany` / `findUnique` / `findFirst` hook that adds `WHERE deletedAt IS NULL` by default. One place, affects every caller. **Recommended.**
2. Hand-port every `prisma.user.find*` call to include the filter. Higher surface area, error-prone.

Choose (1). Create `src/lib/db/prisma-soft-delete.ts`:
```ts
export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-user',
  query: {
    user: {
      async findMany({ args, query }) {
        args.where = { deletedAt: null, ...args.where }
        return query(args)
      },
      async findUnique({ args, query }) {
        // Caller can bypass via args.where.deletedAt passed explicitly
        return query(args)
      },
      // ... findFirst, count, update (where), etc.
    },
  },
})
```

Extend the Prisma client at its existing construction point
(`src/lib/prisma.ts` or similar — verify path).

### Cleanup script — `scripts/cleanup-legacy-users.ts`

Idempotent one-shot:
1. Opens a transaction.
2. Identifies targets: `SELECT id, email FROM users WHERE addressLine1 IS NULL AND EXISTS (SELECT 1 FROM user_identifiers WHERE user_id = users.id AND verified = false)`.
3. For each target, pre-check: any `Transfer`, `Referral`, or `Recipient` rows? **If YES → log and SKIP** (this isn't test data). If NO → proceed.
4. `UPDATE "User" SET deletedAt = NOW() WHERE id = ?`.
5. Logs before/after row counts.
6. Commits.

Run with: `pnpm tsx scripts/cleanup-legacy-users.ts --dry-run` (default) or `--apply` (actually commits).

### AuthEvent
No change. The Restrict FK works as intended — nothing deletes it.

---

## Required Tests (TDD-first)

1. **`tests/lib/db/prisma-soft-delete.test.ts`** — 5 cases
   - `findMany` without `deletedAt` filter excludes soft-deleted rows
   - `findMany` with explicit `deletedAt: { not: null }` overrides and returns only deleted rows
   - `findUnique` follows the same rule
   - `count` excludes deleted rows by default
   - `update` on a soft-deleted row is a no-op (zero affected — extension adds WHERE deletedAt IS NULL to the update's where clause)

2. **`tests/scripts/cleanup-legacy-users.test.ts`** — 4 cases
   - Dry-run reports targets but mutates nothing
   - Apply flips `deletedAt` for a matching row
   - Apply SKIPS a row that has a Transfer attached (with log)
   - Apply is idempotent — running twice flips only once (second run is a no-op because the row is now `deletedAt IS NOT NULL`)

3. **Existing test scan** — verify no breakage
   - Run `npm test -- --run` after the middleware lands but before the script runs. Any test that relied on seeing a soft-deletable row needs updating (unlikely; test fixtures are fresh rows per test).

---

## Verification Checklist (Bob, before REVIEW-REQUEST)

- [ ] Option chosen and documented in §Policy Decision Resolved.
- [ ] Migration runs clean on local DB.
- [ ] `prisma generate` ran; extension types compile.
- [ ] `npm test -- --run` → baseline + 9 passing.
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `rm -rf .next && npm run build` → success.
- [ ] Dry-run executed locally on a seed that includes a legacy-shaped row: output names the targets, no mutation.
- [ ] Apply executed locally: targets flipped, idempotent on second run.
- [ ] Pre-prod: Bob must NOT run `--apply` against prod without Arch's go-ahead.

---

## Deploy Plan (Arch)

Two commits, in order:
1. Schema + middleware + tests. Deploy. Confirm migration ran on Railway.
2. Run the cleanup script against prod **manually** with `--dry-run` first; review output with Arch; then `--apply`. Log the output under `handoff/STEP-25-PROD-RUN.md`.

Rollback: `UPDATE "User" SET deletedAt = NULL WHERE deletedAt = '<timestamp-window>'` — fully reversible. The schema/migration itself is a pure addition and does not need reverting.

---

## Non-goals

- GDPR right-to-be-forgotten (separate regime).
- AuthEvent scrub — do not touch the audit log.
- Backfilling soft-delete semantics to other tables (Recipient, Transfer, etc) — YAGNI until a concrete need appears.
- User lifecycle states (`active`, `suspended`) — different column, different step.

---

## Files Bob will touch (expected ~8, assuming Option B)

- **New** (2): `scripts/cleanup-legacy-users.ts`, `src/lib/db/prisma-soft-delete.ts`
- **New tests** (2): `tests/lib/db/prisma-soft-delete.test.ts`, `tests/scripts/cleanup-legacy-users.test.ts`
- **New migration** (1): `prisma/migrations/<ts>_user_soft_delete/migration.sql`
- **Modified** (3): `prisma/schema.prisma`, `src/lib/prisma.ts` (extend the client), `handoff/BUILD-LOG.md` (Arch's step log)

Two local commits. No push (Arch decides when).
