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

// Thrown when credentials are valid but the email identifier hasn't been
// verified yet. The route catches it, issues a fresh verification code, and
// returns 202 with `requiresVerification: true` — the user is bounced to
// the /verify-email page rather than receiving a session cookie.
//
// Critically, this is thrown ONLY after password validation succeeds, so an
// attacker can't use it to enumerate which emails exist (wrong password
// always returns 'Invalid credentials' from earlier in the flow).
export class EmailNotVerifiedError extends Error {
  readonly userId: string
  readonly email: string
  readonly fullName: string

  constructor(opts: { userId: string; email: string; fullName: string }) {
    super('Email not verified')
    this.name = 'EmailNotVerifiedError'
    this.userId = opts.userId
    this.email = opts.email
    this.fullName = opts.fullName
  }
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

  // Verify-then-login gate. Password is valid AND the identifier is an
  // unverified email → throw a typed error. The route catches it, sends a
  // fresh code, and bounces the user to the verify screen. Only EMAIL
  // identifiers gate; phone-only logins (when we add them) bypass.
  if (identRecord.type === 'EMAIL' && !identRecord.verified) {
    await logAuthEvent({
      userId: user.id,
      event: 'LOGIN_FAILED',
      ip,
      metadata: { identifier, reason: 'email_not_verified' },
    })
    throw new EmailNotVerifiedError({
      userId: user.id,
      email: identRecord.identifier,
      fullName: user.fullName,
    })
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
