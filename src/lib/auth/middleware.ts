import { validateSession } from './sessions'
import { prisma } from '@/lib/db/client'
import type { Session } from '@/generated/prisma/client'

const SESSION_COOKIE_NAME = 'kolaleaf_session'
const PENDING_2FA_COOKIE_NAME = 'kolaleaf_pending_2fa'

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.split(';').find((c) => c.trim().startsWith(`${name}=`))
  if (!match) return null
  return match.split('=')[1]?.trim() ?? null
}

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  return getCookieValue(cookieHeader, SESSION_COOKIE_NAME)
}

export function getPendingTwoFactorChallengeIdFromCookie(cookieHeader: string | null): string | null {
  return getCookieValue(cookieHeader, PENDING_2FA_COOKIE_NAME)
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

export function requirePendingTwoFactorChallenge(request: Request): { challengeId: string } {
  const challengeId = getPendingTwoFactorChallengeIdFromCookie(request.headers.get('cookie'))
  if (!challengeId) {
    throw new AuthError(401, '2FA challenge required')
  }
  return { challengeId }
}

/**
 * Blocks the request if the user's primary EMAIL identifier is unverified.
 *
 * Additive check — existing routes that don't call this keep working. Intended
 * for money-moving endpoints (transfer creation) where an unverified account
 * is a compliance and fraud risk.
 */
export async function requireEmailVerified(request: Request): Promise<{ userId: string }> {
  const { userId } = await requireAuth(request)
  const email = await prisma.userIdentifier.findFirst({
    where: { userId, type: 'EMAIL' },
    orderBy: { createdAt: 'asc' },
  })
  if (!email || !email.verified) {
    throw new AuthError(403, 'email_unverified')
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

// Always emit Secure on the session cookie so the token never traverses
// a non-HTTPS hop regardless of NODE_ENV. Browsers exempt localhost
// from the Secure requirement automatically, so local dev still works
// over http://localhost. Any non-localhost non-HTTPS environment (a
// staging host over plain http, a preview deploy behind a misconfigured
// proxy) correctly refuses the cookie — fail-closed rather than leak.
//
// The earlier `NODE_ENV === 'production' ? '; Secure' : ''` gate was
// fail-open: a deploy with NODE_ENV unset would ship the token over
// plain HTTP.
export function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900; Secure`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`
}

export function setPendingTwoFactorCookie(challengeId: string): string {
  return `${PENDING_2FA_COOKIE_NAME}=${challengeId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300; Secure`
}

export function clearPendingTwoFactorCookie(): string {
  return `${PENDING_2FA_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`
}
