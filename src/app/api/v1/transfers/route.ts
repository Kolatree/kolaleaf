import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import {
  createTransfer,
  listTransfers,
  KycNotVerifiedError,
  RecipientNotOwnedError,
  InvalidCorridorError,
  AmountOutOfRangeError,
  DailyLimitExceededError,
} from '@/lib/transfers'
import { requireAuth, requireEmailVerified, AuthError } from '@/lib/auth/middleware'
import { parseBody } from '@/lib/http/validate'
import { jsonError } from '@/lib/http/json-error'
import { extractRequestContext } from '@/lib/security/request-context'
import { CreateTransferBody } from './_schemas'

export async function POST(request: Request) {
  try {
    // Auth MUST run before Zod — a 422 on a schema failure from an
    // unauthenticated caller leaks endpoint existence and body shape.
    // Email verification is required (we need a reliable contact for
    // transfer failures / refunds / compliance holds). KYC is NOT
    // required here — users can create a CREATED transfer without
    // verification and progress to the verification wizard afterwards.
    // The KYC gate lives downstream at generatePayIdForTransfer, which
    // is the point where we start collecting AUD.
    const { userId } = await requireEmailVerified(request)

    const parsed = await parseBody(request, CreateTransferBody)
    if (!parsed.ok) return parsed.response
    const { recipientId, corridorId, sendAmount, exchangeRate, fee } = parsed.data

    const transfer = await createTransfer({
      userId,
      recipientId,
      corridorId,
      sendAmount: new Decimal(sendAmount),
      exchangeRate: new Decimal(exchangeRate),
      fee: new Decimal(fee ?? '0'),
      securityContext: extractRequestContext(request),
    })

    return NextResponse.json({ transfer }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.message === 'email_unverified') {
        return jsonError('email_unverified', 'Please verify your email before sending money.', 403)
      }
      return jsonError('unauthenticated', error.message, error.statusCode)
    }
    const message = error instanceof Error ? error.message : 'Transfer creation failed'

    if (error instanceof KycNotVerifiedError) return jsonError('kyc_not_verified', message, 403)
    if (error instanceof RecipientNotOwnedError) return jsonError('recipient_not_owned', message, 403)
    if (error instanceof InvalidCorridorError) return jsonError('invalid_corridor', message, 400)
    if (error instanceof AmountOutOfRangeError) return jsonError('amount_out_of_range', message, 400)
    if (error instanceof DailyLimitExceededError) return jsonError('daily_limit_exceeded', message, 400)

    return jsonError('transfer_creation_failed', message, 500)
  }
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? undefined
    const limit = url.searchParams.get('limit')
    const cursor = url.searchParams.get('cursor') ?? undefined

    const result = await listTransfers(userId, {
      status: status as NonNullable<Parameters<typeof listTransfers>[1]>['status'],
      limit: limit ? Math.min(parseInt(limit, 10), 100) : undefined,
      cursor,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError('unauthenticated', error.message, error.statusCode)
    }
    return jsonError('list_transfers_failed', 'Failed to list transfers', 500)
  }
}
