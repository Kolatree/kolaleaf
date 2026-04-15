import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { normalizePhone, generateSmsCode, InvalidPhoneError } from '@/lib/auth/phone'
import { sendSms } from '@/lib/sms'

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 3

/**
 * POST /api/account/phone/add
 *
 * Authenticated. Starts (or re-starts) phone verification for the current user.
 *
 * Flow:
 *   1. Normalise the number to E.164.
 *   2. Reject if another user owns this phone AND has it verified — E.164
 *      uniqueness at the verified-identifier layer. (Unverified holds are
 *      allowed because a legitimate owner must be able to reclaim an
 *      abandoned unverified claim.)
 *   3. Rate-limit: max 3 codes per user+phone per hour.
 *   4. Upsert an unverified `UserIdentifier` for this (user, phone).
 *   5. Invalidate any outstanding unused codes for this (user, phone).
 *   6. Create a new 6-digit code + bcrypt hash, 10-min expiry.
 *   7. Send via Twilio (dev: console.log). SMS failure is logged but we still
 *      return 200 because the code row is persisted — the user can retry.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const body = (await request.json().catch(() => null)) as { phone?: unknown } | null
    const rawPhone = typeof body?.phone === 'string' ? body.phone : ''

    let phone: string
    try {
      phone = normalizePhone(rawPhone)
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        return NextResponse.json({ error: 'invalid_phone', message: err.message }, { status: 400 })
      }
      throw err
    }

    // E.164 uniqueness — only block when another user has this phone verified.
    const existing = await prisma.userIdentifier.findUnique({
      where: { identifier: phone },
    })
    if (existing && existing.userId !== userId && existing.verified) {
      return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
    }

    // Rate limit BEFORE mutating state.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS)
    const recent = await prisma.phoneVerificationCode.count({
      where: { userId, phone, createdAt: { gte: windowStart } },
    })
    if (recent >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: Math.floor(RATE_LIMIT_WINDOW_MS / 1000) },
        { status: 429 },
      )
    }

    // Create or refresh the unverified PHONE identifier for this user.
    //
    // `UserIdentifier.identifier` is globally unique. If an unverified row
    // exists under a DIFFERENT user (an abandoned claim), we transfer
    // ownership to the current caller — otherwise the subsequent
    // `userIdentifier.update where: { identifier: phone }` in /verify would
    // flip verified=true on the wrong user's row.
    //
    // We already returned 409 above when the existing row is verified AND
    // belongs to another user, so the only cross-user case that reaches
    // here is an unverified abandoned hold. `verifiedAt: null` is set
    // defensively — a verified row that slipped past the 409 guard (it
    // shouldn't) must not retain its timestamp after ownership changes.
    await prisma.userIdentifier.upsert({
      where: { identifier: phone },
      create: {
        userId,
        type: 'PHONE',
        identifier: phone,
        verified: false,
      },
      update: {
        userId,
        verified: false,
        verifiedAt: null,
      },
    })

    // Invalidate any prior unused codes for this phone — including any
    // issued to the previous owner if we just transferred the identifier.
    // Scope by `phone` only (NOT by userId) so an abandoned claim's
    // outstanding codes can't be replayed by the new owner.
    await prisma.phoneVerificationCode.updateMany({
      where: { phone, usedAt: null },
      data: { usedAt: new Date() },
    })

    const { code, hash } = generateSmsCode()
    const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    await prisma.phoneVerificationCode.create({
      data: {
        userId,
        phone,
        codeHash: hash,
        expiresAt,
      },
    })

    const smsResult = await sendSms({
      to: phone,
      body: `Your Kolaleaf verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`,
    })
    if (!smsResult.ok) {
      // Row is persisted; user can retry via another POST. Do not 5xx — that
      // would imply state corruption. Log for ops visibility.
      console.error('[phone/add] SMS send failed:', smsResult.error)
    }

    return NextResponse.json({ sent: true }, { status: 200 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/phone/add]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
