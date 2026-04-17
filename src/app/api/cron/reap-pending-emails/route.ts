import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { authorizeCron } from '@/lib/auth/cron-auth'

// POST /api/cron/reap-pending-emails
//
// Janitor for abandoned PendingEmailVerification rows. The wizard's
// upsert model keeps the table bounded by unique emails, but every
// visitor who starts /send-code and never finishes leaves a row
// behind forever unless they return (which overwrites in place).
//
// We delete rows that fall into one of two terminal states:
//
//   (a) "never verified and expired" — expiresAt is older than 24 hours
//       AND verifiedAt is null. These are dead codes whose sender
//       abandoned the flow.
//
//   (b) "verified but claim window closed long ago" — claimExpiresAt
//       is older than 7 days AND the claim was never completed (the
//       success path deletes the row in the same tx that creates the
//       User). Seven days leaves headroom for a user to return within
//       the same week to finish, without pretending the verified email
//       is a permanent credential.
//
// The schedule is hourly at :15 (staggered off the :00 / :15 / :30
// crons already in railway.toml to avoid pool contention). Protect
// with CRON_SECRET like every other cron endpoint.
//
// Returns a small counter payload so ops can alert on abnormal volume.
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const expiredCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const claimStaleCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  try {
    const expired = await prisma.pendingEmailVerification.deleteMany({
      where: {
        verifiedAt: null,
        expiresAt: { lt: expiredCutoff },
      },
    })

    const staleClaims = await prisma.pendingEmailVerification.deleteMany({
      where: {
        verifiedAt: { not: null },
        claimExpiresAt: { lt: claimStaleCutoff },
      },
    })

    const out = {
      deletedExpired: expired.count,
      deletedStaleClaims: staleClaims.count,
      ts: now.toISOString(),
    }

    console.log(JSON.stringify({ level: 'info', route: 'cron/reap-pending-emails', ...out }))
    return NextResponse.json(out)
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        route: 'cron/reap-pending-emails',
        error: err instanceof Error ? err.message : String(err),
        ts: now.toISOString(),
      }),
    )
    return NextResponse.json(
      { error: 'Janitor sweep failed' },
      { status: 500 },
    )
  }
}
