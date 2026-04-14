import { validateSession } from './sessions'
import { prisma } from '@/lib/db/client'
import type { Session } from '@/generated/prisma/client'

const SESSION_COOKIE_NAME = 'kolaleaf_session'

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.split(';').find((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!match) return null
  return match.split('=')[1]?.trim() ?? null
}

export async function getSessionFromRequest(request: Request): Promise<Session | null> {
  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)
  if (!token) return null
  return validateSession(token)
}

export async function requireAuth(request: Request): Promise<{ userId: string; session: Session }> {
  const session = await getSessionFromRequest(request)
  if (!session) {
    throw new AuthError(401, 'Authentication required')
  }
  return { userId: session.userId, session }
}

export async function requireKyc(request: Request): Promise<{ userId: string }> {
  const { userId } = await requireAuth(request)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.kycStatus !== 'VERIFIED') {
    throw new AuthError(403, 'KYC verification required')
  }
  return { userId }
}

export class AuthError extends Error {
  public readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

export function setSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}
