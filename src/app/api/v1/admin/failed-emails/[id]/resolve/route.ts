import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

// POST /api/v1/admin/failed-emails/[id]/resolve
//
// Marks the row resolvedAt = now, resolvedBy = adminUserId. Idempotent:
// if already resolved, returns the existing resolvedAt/resolvedBy
// rather than clobbering the original resolver's attribution.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id } = await params

    const existing = await prisma.failedEmail.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // Preserve the original resolver on repeat calls so audit lineage
    // doesn't get overwritten. First-writer-wins semantics.
    if (existing.resolvedAt) {
      return NextResponse.json({
        id: existing.id,
        resolvedAt: existing.resolvedAt.toISOString(),
        resolvedBy: existing.resolvedBy ?? userId,
      })
    }

    const resolvedAt = new Date()
    const updated = await prisma.failedEmail.update({
      where: { id },
      data: { resolvedAt, resolvedBy: userId },
    })

    return NextResponse.json({
      id: updated.id,
      resolvedAt: updated.resolvedAt!.toISOString(),
      resolvedBy: updated.resolvedBy!,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to resolve' }, { status: 500 })
  }
}
