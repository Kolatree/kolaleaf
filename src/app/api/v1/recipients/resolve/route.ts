import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { createFlutterwaveProvider } from '@/lib/payments/payout/flutterwave'
import {
  AccountNotFoundError,
  PayoutError,
} from '@/lib/payments/payout/types'
import {
  ProviderTemporaryError,
  ProviderTimeoutError,
} from '@/lib/http/retry'

/**
 * POST /api/recipients/resolve
 *
 * Pre-flight bank account lookup. Given a bank code and 10-digit account
 * number, returns the account holder's canonical name from Flutterwave.
 *
 * This is a verification step, not a persistence step — the UI calls this
 * while the user is typing an account number, then submits the resolved
 * name to `POST /api/recipients` only when the user confirms.
 *
 * Rate-limited per-user to 20/min to prevent account-number probing. The
 * map is in-memory (single-process) for now; a shared limiter can replace
 * it when we scale horizontally without any API change.
 */
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

interface RateWindow {
  count: number
  windowStart: number
}

const rateLimitMap: Map<string, RateWindow> = new Map()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count += 1
  return true
}

export async function POST(request: Request) {
  let body: { bankCode?: unknown; accountNumber?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { bankCode, accountNumber } = body

  if (typeof bankCode !== 'string' || !bankCode.trim()) {
    return NextResponse.json(
      { error: 'bankCode is required' },
      { status: 400 },
    )
  }
  if (typeof accountNumber !== 'string' || !/^\d{10}$/.test(accountNumber)) {
    return NextResponse.json(
      { error: 'accountNumber must be 10 digits' },
      { status: 400 },
    )
  }

  try {
    const { userId } = await requireAuth(request)

    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429 },
      )
    }

    const provider = createFlutterwaveProvider()
    const { accountName } = await provider.resolveAccount({
      bankCode: bankCode.trim(),
      accountNumber,
    })

    return NextResponse.json({ accountName }, { status: 200 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      )
    }
    if (error instanceof AccountNotFoundError) {
      return NextResponse.json(
        { error: 'account_not_found' },
        { status: 404 },
      )
    }
    if (
      error instanceof ProviderTimeoutError ||
      error instanceof ProviderTemporaryError ||
      (error instanceof PayoutError && error.retryable)
    ) {
      return NextResponse.json(
        { error: 'resolve_unavailable' },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: 'resolve_unavailable' },
      { status: 503 },
    )
  }
}
