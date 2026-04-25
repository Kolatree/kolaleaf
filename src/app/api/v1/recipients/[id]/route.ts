import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { jsonError } from '@/lib/http/json-error'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth(request)
    const { id } = await params

    const recipient = await prisma.recipient.findUnique({ where: { id } })
    if (!recipient) {
      return jsonError('recipient_not_found', 'Recipient not found', 404)
    }
    if (recipient.userId !== userId) {
      return jsonError('forbidden', 'Not authorized', 403)
    }

    await prisma.recipient.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.message, error.message, error.statusCode)
    }
    return jsonError('delete_recipient_failed', 'Failed to delete recipient', 500)
  }
}
