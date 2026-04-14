import crypto from 'crypto'
import { prisma } from '@/lib/db/client'

const SESSION_EXPIRY_MINUTES = 15

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string,
) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000)

  return prisma.session.create({
    data: { userId, token, expiresAt, ip: ip ?? null, userAgent: userAgent ?? null },
  })
}

export async function validateSession(token: string) {
  const session = await prisma.session.findUnique({ where: { token } })
  if (!session) return null
  if (session.expiresAt < new Date()) return null
  return session
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } })
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } })
  return result.count
}

export async function cleanExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
