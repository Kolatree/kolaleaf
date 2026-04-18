import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/admin/compliance/[id]/mark-reported
//
// After an admin files the paper report with AUSTRAC they flip the
// row: reportedAt = now, austracRef = <AUSTRAC reference>. Idempotent
// (first-writer-wins). Auto-filing via AUSTRAC EMS API is DEFERRED.

export const MarkReportedBody = z.object({
  austracRef: z.string().trim().min(1).max(128),
})

export const MarkReportedResponse = z.object({
  id: z.string(),
  reportedAt: z.string(),
  austracRef: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/compliance/{id}/mark-reported',
  tags: ['admin'],
  summary: 'Mark a ComplianceReport as filed with AUSTRAC',
  request: {
    body: { required: true, content: { 'application/json': { schema: MarkReportedBody } } },
  },
  responses: {
    200: {
      description: 'Marked (or was already marked)',
      content: { 'application/json': { schema: MarkReportedResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    403: {
      description: 'Not an admin',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    404: {
      description: 'No report with that id',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
