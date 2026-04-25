import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from './middleware'
import { prisma } from '@/lib/db/client'
import { jsonError } from '@/lib/http/json-error'
import { classifyTransferError } from '@/lib/transfers/errors'
import { log } from '@/lib/obs/logger'

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function requireAdmin(
  request: Request,
): Promise<{ userId: string }> {
  const { userId } = await requireAuth(request)

  const emailIdentifier = await prisma.userIdentifier.findFirst({
    where: { userId, type: 'EMAIL' },
    select: { identifier: true },
  })

  if (!emailIdentifier) {
    throw new AuthError(403, 'Admin access required')
  }

  const adminEmails = getAdminEmails()
  if (!adminEmails.includes(emailIdentifier.identifier.toLowerCase())) {
    throw new AuthError(403, 'Admin access required')
  }

  return { userId }
}

/**
 * Higher-order function that wraps an admin route handler with:
 *   1. `requireAdmin(request)` — auth + admin email check
 *   2. `AuthError` → appropriate HTTP status
 *   3. Domain error classification via `classifyTransferError`
 *   4. Structured logging for unknown errors
 *   5. Generic 500 for anything unrecognised
 *
 * Usage:
 *   export const POST = withAdmin(async (request, userId) => { ... })
 */
export function withAdmin(
  handler: (request: Request, userId: string) => Promise<NextResponse>,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request): Promise<NextResponse> => {
    try {
      const { userId } = await requireAdmin(request)
      return await handler(request, userId)
    } catch (error) {
      if (error instanceof AuthError) {
        return jsonError(error.message, error.message, error.statusCode)
      }

      const classified = classifyTransferError(error)
      if (classified) {
        const message = error instanceof Error ? error.message : 'Request failed'
        return jsonError(classified.reason, message, classified.status)
      }

      log('error', 'admin.route.unhandled', {
        error: error instanceof Error ? error.message : String(error),
        path: request.url,
      })

      return jsonError(
        'internal_error',
        'Internal server error',
        500,
      )
    }
  }
}
