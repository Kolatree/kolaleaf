import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth(request)
    const { id } = await params

    const recipient = await prisma.recipient.findUnique({ where: { id } })
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }
    if (recipient.userId !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    await prisma.recipient.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to delete recipient' }, { status: 500 })
  }
}
