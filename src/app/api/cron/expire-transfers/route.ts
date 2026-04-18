import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { transitionTransfer } from '@/lib/transfers/state-machine'
import { TransferStatus, ActorType } from '@/generated/prisma/enums'
import { log } from '@/lib/obs/logger'

// Dedicated AWAITING_AUD expiry cron.
//
// Step 31 / audit gap #12: previously the expiry step ran inside
// runDailyReconciliation, so a reconciliation failure blocked
// expiry. A dedicated cron isolates the concerns — expiry keeps
// running even if provider-statement reconciliation is temporarily
// broken.
//
// Uses createdAt (not updatedAt) for the cutoff — fixes audit gap
// #11: any row update that bumps updatedAt would previously reset
// the 24h window silently.
//
// Protected by a secret in the CRON_SECRET env var, matching the
// existing cron route convention.

const AWAITING_AUD_EXPIRE_HOURS = 24

export async function POST(request: Request) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const expireCutoff = new Date(Date.now() - AWAITING_AUD_EXPIRE_HOURS * 60 * 60 * 1000)
  const stale = await prisma.transfer.findMany({
    where: {
      status: TransferStatus.AWAITING_AUD,
      createdAt: { lt: expireCutoff },
    },
  })

  const expiredIds: string[] = []
  for (const transfer of stale) {
    try {
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: TransferStatus.EXPIRED,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.AWAITING_AUD,
        metadata: {
          reason: 'awaiting_aud_expired',
          source: 'expire_transfers_cron',
          hoursStale: AWAITING_AUD_EXPIRE_HOURS,
        },
      })
      expiredIds.push(transfer.id)
    } catch (err) {
      // Don't break the batch on one failure — log and continue.
      log('error', 'cron.expire_transfers.transition_failed', {
        transferId: transfer.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  log('info', 'cron.expire_transfers.done', {
    examined: stale.length,
    expired: expiredIds.length,
  })

  return NextResponse.json({ examined: stale.length, expired: expiredIds.length, expiredIds })
}

export { POST as GET }
