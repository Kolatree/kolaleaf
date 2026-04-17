import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { normalizePhone, InvalidPhoneError } from '@/lib/auth/phone'
import { parseBody } from '@/lib/http/validate'
import { RemovePhoneBody } from './_schemas'

/**
 * POST /api/account/phone/remove
 *
 * Authenticated. Remove a PHONE identifier from the current user.
 *
 * Guard: if the user is actively using SMS 2FA (User.twoFactorMethod === 'SMS')
 * they must disable 2FA first — otherwise they'd lock themselves out of the
 * 2FA challenge. 400 `cannot_remove_phone_while_2fa_active`.
 *
 * Deletion is a hard delete of the identifier row. AuthEvent PHONE_REMOVED
 * records the action with the (now-gone) phone value in metadata for audit.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const parsed = await parseBody(request, RemovePhoneBody)
    if (!parsed.ok) return parsed.response
    const { phone: rawPhone } = parsed.data

    let phone: string
    try {
      phone = normalizePhone(rawPhone)
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        return NextResponse.json({ error: 'invalid_phone' }, { status: 400 })
      }
      throw err
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (user?.twoFactorMethod === 'SMS') {
      return NextResponse.json(
        { error: 'cannot_remove_phone_while_2fa_active' },
        { status: 400 },
      )
    }

    const ident = await prisma.userIdentifier.findUnique({
      where: { identifier: phone },
    })
    if (!ident || ident.userId !== userId || ident.type !== 'PHONE') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    await prisma.userIdentifier.delete({ where: { id: ident.id } })
    await prisma.authEvent.create({
      data: {
        userId,
        event: 'PHONE_REMOVED',
        metadata: { phone },
      },
    })

    return NextResponse.json({ removed: true }, { status: 200 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/phone/remove]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
