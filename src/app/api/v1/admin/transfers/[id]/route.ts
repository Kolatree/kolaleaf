import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
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
    // Unknown transfer id → 404. Do not leak Prisma's P2025 message (which
    // mentions model and constraint names).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    console.error('[admin/transfers/[id]]', error)
    return NextResponse.json({ error: 'Failed to fetch transfer' }, { status: 500 })
  }
}
