#!/usr/bin/env tsx
// Step 25: one-shot idempotent cleanup for pre-wizard legacy test users.
//
// Policy: Option B — soft delete via User.deletedAt. AuthEvent chain
// preserved (AUSTRAC 7yr retention). Sessions drop out naturally via
// the soft-delete filter in the next login.
//
// Identification heuristic (from Step 18 BUILD-LOG):
//   User.addressLine1 IS NULL AND has an unverified EMAIL identifier
//
// Safety rails:
//   - Pre-check: abort per-row if the user has ANY Transfer, Referral,
//     or Recipient — those aren't "test data" anymore.
//   - Idempotent: rows already soft-deleted are skipped silently.
//   - Dry-run by default. Pass `--apply` to actually flip deletedAt.
//
// Usage:
//   pnpm tsx scripts/cleanup-legacy-users.ts           # dry run
//   pnpm tsx scripts/cleanup-legacy-users.ts --apply   # commit

import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// IMPORTANT: we construct a bare PrismaClient here without the
// soft-delete extension so we can SEE all rows (including already-
// archived ones) for the idempotency check. The script itself writes
// the archive marker.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

interface CleanupResult {
  examined: number
  archived: number
  skippedAlreadyArchived: number
  skippedHasActivity: string[]
}

export async function cleanupLegacyUsers(opts: { apply: boolean }): Promise<CleanupResult> {
  const candidates = await prisma.user.findMany({
    where: {
      addressLine1: null,
      identifiers: { some: { type: 'EMAIL', verified: false } },
    },
    select: {
      id: true,
      deletedAt: true,
      _count: { select: { transfers: true, recipients: true, referrals: true } },
    },
  })

  const result: CleanupResult = {
    examined: candidates.length,
    archived: 0,
    skippedAlreadyArchived: 0,
    skippedHasActivity: [],
  }

  for (const u of candidates) {
    if (u.deletedAt !== null) {
      result.skippedAlreadyArchived += 1
      continue
    }
    const activity = u._count.transfers + u._count.recipients + u._count.referrals
    if (activity > 0) {
      result.skippedHasActivity.push(u.id)
      continue
    }
    if (opts.apply) {
      await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } })
    }
    result.archived += 1
  }

  return result
}

async function main() {
  const apply = process.argv.includes('--apply')
  const result = await cleanupLegacyUsers({ apply })
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2))
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
