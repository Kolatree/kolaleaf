import bcrypt from 'bcrypt'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from './password'
import { createSession } from './sessions'
import { logAuthEvent } from './audit'

// Pre-computed hash to burn CPU time on failed lookups, preventing timing attacks
const DUMMY_HASH = bcrypt.hashSync('timing-attack-dummy', 12)

interface LoginParams {
  identifier: string
  password: string
  ip?: string
  userAgent?: string
}

export async function loginUser(params: LoginParams) {
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

  if (!identRecord.verified) {
    throw new Error('Identifier not verified')
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

  const session = await createSession(user.id, ip, userAgent)
  const requires2FA = user.totpEnabled

  await logAuthEvent({
    userId: user.id,
    event: 'LOGIN',
    ip,
    metadata: { identifier, requires2FA },
  })

  return { user, session, requires2FA }
}
