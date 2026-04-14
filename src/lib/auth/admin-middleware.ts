import { requireAuth, AuthError } from './middleware'
import { prisma } from '@/lib/db/client'

function getAdminEmails(): string[] {
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
