import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { normalizePhone, verifySmsCode, InvalidPhoneError } from '@/lib/auth/phone'
import { parseBody } from '@/lib/http/validate'
import { VerifyPhoneBody } from './_schemas'

const MAX_ATTEMPTS = 5

/**
 * POST /api/account/phone/verify
 *
 * Authenticated. Consumes a code issued by `/api/account/phone/add`.
 *
 * - Increments `attempts` on every submission (so a wrong guess burns a try).
 * - After 5 total attempts the code is invalidated regardless of correctness.
 * - On success, the matching `UserIdentifier` is flipped to `verified=true`
 *   atomically with the code row being marked used. AuthEvent PHONE_VERIFIED
 *   is written (inside the transaction so an audit hole is impossible).
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const parsed = await parseBody(request, VerifyPhoneBody)
    if (!parsed.ok) return parsed.response
    const { phone: rawPhone, code } = parsed.data

    let phone: string
    try {
      phone = normalizePhone(rawPhone)
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        return NextResponse.json({ error: 'invalid_phone' }, { status: 400 })
      }
      throw err
    }

    // Latest outstanding code for this (user, phone), not yet used, not expired.
    const row = await prisma.phoneVerificationCode.findFirst({
      where: {
        userId,
        phone,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!row) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    const willExceed = row.attempts + 1 >= MAX_ATTEMPTS

    if (willExceed) {
      // Burn the code whether or not this submission is correct — no late
      // correct guess allowed on the 5th attempt. Predictable attacker model.
      await prisma.phoneVerificationCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, usedAt: new Date() },
      })
      return NextResponse.json({ error: 'too_many_attempts' }, { status: 403 })
    }

    const match = await verifySmsCode(code, row.codeHash)
    if (!match) {
      await prisma.phoneVerificationCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      })
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    // Happy path: atomically flip identifier + mark code used.
    // AuthEvent is written in the same transaction so the audit row and the
    // state transition are either both applied or neither is.
    await prisma.$transaction([
      prisma.userIdentifier.update({
        where: { identifier: phone },
        data: { verified: true, verifiedAt: new Date() },
      }),
      prisma.phoneVerificationCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      prisma.authEvent.create({
        data: {
          userId,
          event: 'PHONE_VERIFIED',
          metadata: { phone },
        },
      }),
    ])

    return NextResponse.json({ verified: true }, { status: 200 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/phone/verify]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
