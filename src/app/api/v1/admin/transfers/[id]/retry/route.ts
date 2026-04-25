import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { jsonError } from '@/lib/http/json-error'
import { logAuthEvent } from '@/lib/auth/audit'
import { getOrchestrator } from '@/lib/payments/payout/orchestrator'
import {
  InvalidTransitionError,
  ConcurrentModificationError,
  TransferNotFoundError,
} from '@/lib/transfers/errors'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: transferId } = await params

    const transfer = await getOrchestrator().handleManualRetry(transferId, userId)

    await logAuthEvent({
      userId,
      event: 'ADMIN_TRANSFER_RETRY',
      metadata: {
        transferId,
        fromStatus: 'NEEDS_MANUAL',
        action: 'manual_retry',
        payoutProvider: transfer.payoutProvider,
        payoutProviderRef: transfer.payoutProviderRef,
      },
    })

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.message, error.message, error.statusCode)
    }
    if (error instanceof InvalidTransitionError || error instanceof ConcurrentModificationError) {
      return jsonError('conflict', error.message, 409)
    }
    if (error instanceof TransferNotFoundError) {
      return jsonError('transfer_not_found', error.message, 404)
    }
    const message = error instanceof Error ? error.message : 'Retry failed'
    return jsonError('retry_failed', message, 500)
  }
}
