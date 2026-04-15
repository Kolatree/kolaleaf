import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { createTransfer, listTransfers } from '@/lib/transfers'
import { requireKyc, requireAuth, requireEmailVerified, AuthError } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  let body: {
    recipientId?: string
    corridorId?: string
    sendAmount?: string | number
    exchangeRate?: string | number
    fee?: string | number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { recipientId, corridorId, sendAmount, exchangeRate, fee } = body

  if (!recipientId || typeof recipientId !== 'string') {
    return NextResponse.json({ error: 'recipientId is required' }, { status: 400 })
  }
  if (!corridorId || typeof corridorId !== 'string') {
    return NextResponse.json({ error: 'corridorId is required' }, { status: 400 })
  }
  if (sendAmount === undefined || sendAmount === null) {
    return NextResponse.json({ error: 'sendAmount is required' }, { status: 400 })
  }
  if (exchangeRate === undefined || exchangeRate === null) {
    return NextResponse.json({ error: 'exchangeRate is required' }, { status: 400 })
  }

  try {
    // Email verification must land before KYC — an unverified email means we
    // can't safely contact the user about their transfer (failure, refund,
    // compliance holds). This is additive: existing callers who are already
    // KYC-verified will also have been email-verified at signup.
    await requireEmailVerified(request)
    const { userId } = await requireKyc(request)

    const transfer = await createTransfer({
      userId,
      recipientId,
      corridorId,
      sendAmount: new Decimal(String(sendAmount)),
      exchangeRate: new Decimal(String(exchangeRate)),
      fee: new Decimal(String(fee ?? 0)),
    })

    return NextResponse.json({ transfer }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.message === 'email_unverified') {
        return NextResponse.json(
          {
            error: 'email_unverified',
            message: 'Please verify your email before sending money.',
          },
          { status: 403 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Transfer creation failed'
    const name = error instanceof Error ? error.name : ''

    if (name === 'KycNotVerifiedError') return NextResponse.json({ error: message }, { status: 403 })
    if (name === 'RecipientNotOwnedError') return NextResponse.json({ error: message }, { status: 403 })
    if (name === 'InvalidCorridorError') return NextResponse.json({ error: message }, { status: 400 })
    if (name === 'AmountOutOfRangeError') return NextResponse.json({ error: message }, { status: 400 })
    if (name === 'DailyLimitExceededError') return NextResponse.json({ error: message }, { status: 400 })

    return NextResponse.json({ error: message }, { status: 500 })
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
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to list transfers' }, { status: 500 })
  }
}
