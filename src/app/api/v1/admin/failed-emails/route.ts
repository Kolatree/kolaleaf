import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { ListFailedEmailsQuery } from './_schemas'

// GET /api/v1/admin/failed-emails
//
// Admin list of permanent-failure email jobs (Step 23's FailedEmail
// sink). Oldest-unresolved-first so oncall drains a queue rather
// than chasing the latest. Cursor-pagination: `?cursor=<id>` starts
// after the given row id.
export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const url = new URL(request.url)
    const parsed = ListFailedEmailsQuery.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      resolved: url.searchParams.get('resolved') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 })
    }
    const { limit, cursor, resolved } = parsed.data

    const where =
      resolved === 'true'
        ? { resolvedAt: { not: null } }
        : resolved === 'false'
          ? { resolvedAt: null }
          : {}

    const rows = await prisma.failedEmail.findMany({
      where,
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { failedAt: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? items[items.length - 1].id : null

    return NextResponse.json({
      items: items.map((r) => ({
        id: r.id,
        toEmail: r.toEmail,
        template: r.template,
        attempts: r.attempts,
        lastError: r.lastError,
        failedAt: r.failedAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedBy,
      })),
      nextCursor,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 })
  }
}
