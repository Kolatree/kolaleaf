import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const url = new URL(request.url)
    const type = url.searchParams.get('type') ?? undefined
    const status = url.searchParams.get('status') ?? undefined
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)
    const cursor = url.searchParams.get('cursor') ?? undefined

    const where: Record<string, unknown> = {}
    if (type) where.type = type
    if (status === 'PENDING') where.reportedAt = null
    if (status === 'REPORTED') where.reportedAt = { not: null }

    const reports = await prisma.complianceReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })

    const hasMore = reports.length > limit
    const page = hasMore ? reports.slice(0, limit) : reports
    const nextCursor = hasMore ? page[page.length - 1].id : undefined

    return NextResponse.json({ reports: page, nextCursor })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to fetch compliance reports' }, { status: 500 })
  }
}
