import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '@/lib/auth/audit'
import { parseBody } from '@/lib/http/validate'
import { MarkReportedBody } from './_schemas'

// POST /api/v1/admin/compliance/[id]/mark-reported
//
// Flips reportedAt = now + austracRef = <ref>. Idempotent: a row
// already marked returns its existing values without clobbering the
// original austracRef (first-writer-wins). Every call writes an
// ADMIN_COMPLIANCE_MARK_REPORTED AuthEvent tying the admin userId to
// the ComplianceReport id for the audit chain.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)

    const parsed = await parseBody(request, MarkReportedBody)
    if (!parsed.ok) return parsed.response
    const { austracRef } = parsed.data

    const { id } = await params
    const existing = await prisma.complianceReport.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (existing.reportedAt) {
      return NextResponse.json({
        id: existing.id,
        reportedAt: existing.reportedAt.toISOString(),
        austracRef: existing.austracRef ?? austracRef,
      })
    }

    const reportedAt = new Date()
    const updated = await prisma.complianceReport.update({
      where: { id },
      data: { reportedAt, austracRef },
    })

    await logAuthEvent({
      userId,
      event: 'ADMIN_COMPLIANCE_MARK_REPORTED',
      metadata: {
        complianceReportId: id,
        reportType: existing.type,
        austracRef,
      },
    })

    return NextResponse.json({
      id: updated.id,
      reportedAt: updated.reportedAt!.toISOString(),
      austracRef: updated.austracRef!,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to mark reported' }, { status: 500 })
  }
}
