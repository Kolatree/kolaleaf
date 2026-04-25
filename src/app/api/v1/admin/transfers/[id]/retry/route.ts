import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/auth/admin-middleware'
import { logAuthEvent } from '@/lib/auth/audit'
import { getOrchestrator } from '@/lib/payments/payout/orchestrator'

export const POST = withAdmin(async (request, userId) => {
  const url = new URL(request.url)
  const transferId = url.pathname.split('/').at(-2)!

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
})
