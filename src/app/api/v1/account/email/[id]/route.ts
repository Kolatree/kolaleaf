import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

// DELETE /api/account/email/[id]
//
// Removes a secondary email identifier from the user's account. Blocks
// removal when the identifier is the user's only verified email — users
// must retain at least one verified email for password-reset deliverability.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  try {
    const { userId } = await requireAuth(request)

    const identifier = await prisma.userIdentifier.findUnique({ where: { id } })

    if (!identifier || identifier.userId !== userId || identifier.type !== 'EMAIL') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // If the identifier under removal is verified, require another verified
    // email to remain. Unverified identifiers can always be removed — they
    // are not a recovery channel.
    if (identifier.verified) {
      const otherVerified = await prisma.userIdentifier.count({
        where: {
          userId,
          type: 'EMAIL',
          verified: true,
          id: { not: id },
        },
      })
      if (otherVerified === 0) {
        return NextResponse.json(
          { error: 'cannot_remove_only_email' },
          { status: 400 },
        )
      }
    }

    await prisma.userIdentifier.delete({ where: { id } })

    await prisma.authEvent.create({
      data: {
        userId,
        event: 'EMAIL_REMOVED',
        metadata: {
          removedEmail: identifier.identifier,
          wasVerified: identifier.verified,
        },
      },
    })

    return NextResponse.json({ removed: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/email/remove]', error)
    return NextResponse.json(
      { error: 'Unable to remove email' },
      { status: 500 },
    )
  }
}
