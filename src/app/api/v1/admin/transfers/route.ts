import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import type { TransferStatus } from '@/generated/prisma/enums'

export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const url = new URL(request.url)
    const status = url.searchParams.get('status') as TransferStatus | null
    const search = url.searchParams.get('search')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)
    const cursor = url.searchParams.get('cursor') ?? undefined

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (from) where.createdAt = { ...(where.createdAt as object ?? {}), gte: new Date(from) }
    if (to) where.createdAt = { ...(where.createdAt as object ?? {}), lte: new Date(to) }

    if (search) {
      where.OR = [
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { recipient: { fullName: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const transfers = await prisma.transfer.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true } },
        recipient: { select: { id: true, fullName: true, bankName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })

    const hasMore = transfers.length > limit
    const page = hasMore ? transfers.slice(0, limit) : transfers
    const nextCursor = hasMore ? page[page.length - 1].id : undefined

    return NextResponse.json({ transfers: page, nextCursor })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to list transfers' }, { status: 500 })
  }
}
