import bcrypt from 'bcrypt'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from './password'
import { createSession } from './sessions'
import { logAuthEvent } from './audit'
import { issueSmsChallenge } from './two-factor-challenge'

// Pre-computed hash to burn CPU time on failed lookups, preventing timing attacks
const DUMMY_HASH = bcrypt.hashSync('timing-attack-dummy', 12)

interface LoginParams {
  identifier: string
  password: string
  ip?: string
  userAgent?: string
}

// Narrow User — loginUser always returns a real user (throws if not found),
// so the nullable Prisma return type is not propagated to callers.
type LoggedInUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>

interface LoginResult {
  user: LoggedInUser
  session: Awaited<ReturnType<typeof createSession>>
  requires2FA: boolean
  twoFactorMethod: 'NONE' | 'TOTP' | 'SMS'
  challengeId?: string
}

export async function loginUser(params: LoginParams): Promise<LoginResult> {
  const { identifier, password, ip, userAgent } = params

  // Find the identifier record
  const identRecord = await prisma.userIdentifier.findUnique({
    where: { identifier },
    include: { user: true },
  })

  if (!identRecord) {
    // Burn time equivalent to a real bcrypt comparison to prevent identifier enumeration
    await bcrypt.compare(password, DUMMY_HASH)
    throw new Error('Invalid credentials')
  }

  // NOTE: We deliberately do NOT gate login on identifier.verified anymore.
  // Users must be able to sign in with an unverified email so they can request
  // a fresh verification link. The real enforcement for money-moving actions
  // lives in `requireEmailVerified` (see src/lib/auth/middleware.ts).

  const user = identRecord.user

  if (!user.passwordHash) {
    throw new Error('Invalid credentials')
  }

  const passwordValid = await verifyPassword(password, user.passwordHash)
  if (!passwordValid) {
    await logAuthEvent({
      userId: user.id,
      event: 'LOGIN_FAILED',
      ip,
      metadata: { identifier, reason: 'wrong password' },
    })
    throw new Error('Invalid credentials')
  }

  const session = await createSession(user.id, ip, userAgent)
  const method = user.twoFactorMethod
  const requires2FA = method !== 'NONE'

  // For SMS 2FA we issue the challenge at login time so the user gets the
  // code immediately. The caller persists `challengeId` on the pending-login
  // session and submits it with the code to /api/auth/verify-2fa.
  let challengeId: string | undefined
  if (method === 'SMS') {
    const primaryPhone = await prisma.userIdentifier.findFirst({
      where: { userId: user.id, type: 'PHONE', verified: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!primaryPhone) {
      // Enabled SMS 2FA but phone removed out-of-band — fail closed rather
      // than silently downgrade to no-2FA. User must recover via backup code.
      await logAuthEvent({
        userId: user.id,
        event: 'LOGIN_FAILED',
        ip,
        metadata: { identifier, reason: 'sms_2fa_enabled_without_phone' },
      })
      throw new Error('2FA misconfigured — contact support')
    }
    const issued = await issueSmsChallenge(user.id, primaryPhone.identifier)
    challengeId = issued.challengeId
  }

  await logAuthEvent({
    userId: user.id,
    event: 'LOGIN',
    ip,
    metadata: { identifier, requires2FA, twoFactorMethod: method },
  })

  return { user, session, requires2FA, twoFactorMethod: method, challengeId }
}
