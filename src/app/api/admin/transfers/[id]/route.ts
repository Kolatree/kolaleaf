import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request)
    const { id } = await params

    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, fullName: true } },
        recipient: { select: { id: true, fullName: true, bankName: true } },
      },
    })
    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch transfer'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
