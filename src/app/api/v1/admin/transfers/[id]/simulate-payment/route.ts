import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { handlePaymentReceived } from '@/lib/payments/monoova/payid-service'
import { isStubProvidersEnabled } from '@/lib/payments/flag'
import { logAuthEvent } from '@/lib/auth/audit'
import { SimulatePaymentBody } from './_schemas'

// POST /api/v1/admin/transfers/:id/simulate-payment
//
// Dev-only trigger for the AWAITING_AUD → AUD_RECEIVED transition.
// Exists so local ops can exercise the post-payment half of the
// transaction flow without a Monoova sandbox webhook round-trip.
//
// Prod safety:
//   - Returns 404 (not 403) when we're in production AND the stub flag
//     is off — an accidental Railway deploy can't advertise the route.
//   - Hard-requires `KOLA_USE_STUB_PROVIDERS=true` even in non-prod
//     environments. Staging/preview still uses real provider adapters
//     by default, and simulate-payment against real providers would
//     drive live transfers to COMPLETED without a real customer
//     payment. The stub-mode cascade inside handlePaymentReceived
//     (auto-fire handlePayoutSuccess) is what makes this route safe
//     to expose at all, and that cascade only runs when the flag is
//     on.
//   - Admin auth is still required even when stub mode is on.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (process.env.NODE_ENV === 'production' && !isStubProvidersEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Even in non-prod, refuse to run unless stub mode is explicitly
    // on. Otherwise a staging admin session could drive a real-provider
    // transfer to COMPLETED without a real customer payment.
    if (!isStubProvidersEnabled()) {
      return NextResponse.json(
        {
          error: 'stub_mode_required',
          message:
            'simulate-payment requires KOLA_USE_STUB_PROVIDERS=true; ' +
            'real-provider simulation would drive live transfers.',
        },
        { status: 403 },
      )
    }

    const { userId: adminId } = await requireAdmin(request)
    const { id: transferId } = await params

    // Body is optional. Parse only when the client actually sent one;
    // an empty body + no content-type header means "use the default
    // amount" (the transfer's own sendAmount) rather than rejecting with
    // 400 malformed_json.
    let amountOverride: string | undefined
    const rawBody = await request.text()
    if (rawBody && rawBody.trim()) {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawBody)
      } catch {
        return NextResponse.json(
          { error: 'malformed_json', message: 'Request body is not valid JSON' },
          { status: 400 },
        )
      }
      const schemaParsed = SimulatePaymentBody.safeParse(parsedJson)
      if (!schemaParsed.success) {
        return NextResponse.json(
          { error: 'validation_failed', message: schemaParsed.error.message },
          { status: 422 },
        )
      }
      amountOverride = schemaParsed.data.amount
    }

    // Look up the transfer so we can default the amount when omitted.
    const transfer = await prisma.transfer.findUnique({
      where: { id: transferId },
      select: { sendAmount: true },
    })
    if (!transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
    }

    const amount = new Decimal(amountOverride ?? transfer.sendAmount.toString())

    const updated = await handlePaymentReceived(transferId, amount)

    await logAuthEvent({
      userId: adminId,
      event: 'ADMIN_SIMULATE_PAYMENT',
      metadata: {
        transferId,
        amount: amount.toFixed(2),
        overridden: amountOverride !== undefined,
      },
    })

    return NextResponse.json({ transfer: updated })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    const message = error instanceof Error ? error.message : 'Simulate payment failed'
    const name = error instanceof Error ? error.name : ''

    if (name === 'TransferNotFoundError') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (name === 'InvalidTransitionError' || name === 'ConcurrentModificationError') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (/Amount mismatch/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
