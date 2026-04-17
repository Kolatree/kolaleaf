import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

// GET /api/account/me
//
// Returns the authenticated user's account summary used by the /account page
// client components. Kept intentionally small -- only the fields the UI
// renders. Never returns the password hash, 2FA secret, or backup-code hashes.
//
// 15g extension: now also returns `fullName`, the primary `email` (with id +
// verified flag), and any secondary EMAIL identifiers the user holds (id +
// identifier + verified). Needed so the /account page can render the
// name/email display, badge verified/unverified state, and offer Remove
// buttons for secondary emails without leaking raw rows from the DB.
export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    const phone = await prisma.userIdentifier.findFirst({
      where: { userId, type: 'PHONE', verified: true },
      orderBy: { createdAt: 'asc' },
    })

    // All EMAIL identifiers for this user, oldest first. Primary = first
    // verified; if none is verified (edge case: pre-verification account)
    // fall back to first unverified. The rest are rendered as secondary with
    // Remove controls.
    const emails = await prisma.userIdentifier.findMany({
      where: { userId, type: 'EMAIL' },
      orderBy: { createdAt: 'asc' },
    })
    const primary = emails.find((e) => e.verified) ?? emails[0] ?? null
    const secondary = emails.filter((e) => e.id !== primary?.id)

    return NextResponse.json({
      userId: user.id,
      fullName: user.fullName,
      email: primary
        ? { id: primary.id, email: primary.identifier, verified: primary.verified }
        : null,
      secondaryEmails: secondary.map((e) => ({
        id: e.id,
        email: e.identifier,
        verified: e.verified,
      })),
      twoFactorMethod: user.twoFactorMethod,
      twoFactorEnabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
      hasVerifiedPhone: Boolean(phone),
      phoneMasked: phone ? maskPhone(phone.identifier) : null,
      hasRemainingBackupCodes: user.twoFactorBackupCodes.length > 0,
      backupCodesRemaining: user.twoFactorBackupCodes.length,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/me]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}

function maskPhone(phone: string): string {
  // E.164 input like +61412345678 -> "+61 ••• 678" (first 3 chars + bullet
  // ellipsis + last 3). Good enough for a visual confirmation cue without
  // leaking the middle digits.
  if (phone.length < 6) return phone
  const first = phone.slice(0, 3)
  const last = phone.slice(-3)
  return `${first} ••• ${last}`
}
