import { prisma } from '../db/client'
import { transitionTransfer } from '../transfers/state-machine'
import { TransferStatus, ActorType } from '../../generated/prisma/enums'

const AWAITING_AUD_EXPIRE_HOURS = 24
const PROCESSING_NGN_FLAG_HOURS = 1
const NGN_RETRY_STALE_MINUTES = 30

export interface ReconciliationReport {
  expired: number
  flagged: number
  retried: number
  expiredIds: string[]
  flaggedIds: string[]
  retriedIds: string[]
}

export async function runDailyReconciliation(): Promise<ReconciliationReport> {
  console.log('[worker/reconciliation] start')
  const report: ReconciliationReport = {
    expired: 0,
    flagged: 0,
    retried: 0,
    expiredIds: [],
    flaggedIds: [],
    retriedIds: [],
  }

  try {
    // 1. Expire AWAITING_AUD transfers older than 24h.
    //    Step 31 / audit gap #11: use createdAt, not updatedAt. An
    //    idempotent side-effect touching the row (e.g. a repeat
    //    PayID write bumping updatedAt via Prisma's @updatedAt)
    //    previously reset the 24h window silently. A dedicated cron
    //    at /api/cron/expire-transfers runs independently of this
    //    worker so a reconciliation failure no longer blocks expiry.
    const expireCutoff = new Date(Date.now() - AWAITING_AUD_EXPIRE_HOURS * 60 * 60 * 1000)
    const staleAwaiting = await prisma.transfer.findMany({
      where: {
        status: TransferStatus.AWAITING_AUD,
        createdAt: { lt: expireCutoff },
      },
    })

    for (const transfer of staleAwaiting) {
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: TransferStatus.EXPIRED,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.AWAITING_AUD,
        metadata: { reason: 'reconciliation_expired', hoursStale: AWAITING_AUD_EXPIRE_HOURS },
      })
      report.expired++
      report.expiredIds.push(transfer.id)
    }

    // 2. Flag PROCESSING_NGN transfers stuck for >1h
    const flagCutoff = new Date(Date.now() - PROCESSING_NGN_FLAG_HOURS * 60 * 60 * 1000)
    const stuckProcessing = await prisma.transfer.findMany({
      where: {
        status: TransferStatus.PROCESSING_NGN,
        updatedAt: { lt: flagCutoff },
      },
    })

    for (const transfer of stuckProcessing) {
      // Create a compliance report for review — do NOT change transfer status
      await prisma.complianceReport.create({
        data: {
          type: 'SUSPICIOUS',
          transferId: transfer.id,
          userId: transfer.userId,
          details: {
            reason: 'stuck_processing_ngn',
            source: 'reconciliation_worker',
            stuckSince: transfer.updatedAt.toISOString(),
          },
        },
      })
      report.flagged++
      report.flaggedIds.push(transfer.id)
    }

    // 3. Re-initiate NGN_RETRY transfers stuck for >30min
    const retryCutoff = new Date(Date.now() - NGN_RETRY_STALE_MINUTES * 60 * 1000)
    const staleRetries = await prisma.transfer.findMany({
      where: {
        status: TransferStatus.NGN_RETRY,
        updatedAt: { lt: retryCutoff },
      },
    })

    for (const transfer of staleRetries) {
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: TransferStatus.PROCESSING_NGN,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_RETRY,
        metadata: { reason: 'reconciliation_retry', minutesStale: NGN_RETRY_STALE_MINUTES },
      })
      report.retried++
      report.retriedIds.push(transfer.id)
    }

    console.log(
      `[worker/reconciliation] success expired=${report.expired} flagged=${report.flagged} retried=${report.retried}`,
    )
    return report
  } catch (err) {
    console.error('[worker/reconciliation] failed', err)
    throw err
  }
}
