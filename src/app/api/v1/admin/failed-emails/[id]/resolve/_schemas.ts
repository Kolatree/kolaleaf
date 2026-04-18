import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/admin/failed-emails/[id]/resolve
//
// Marks a FailedEmail row as resolved. Idempotent — resolving an
// already-resolved row is a no-op that still returns 200.
// Note is a free-text reason stored alongside resolvedBy.

export const ResolveFailedEmailBody = z.object({
  note: z.string().max(500).optional(),
})

export const ResolveFailedEmailResponse = z.object({
  id: z.string(),
  resolvedAt: z.string(),
  resolvedBy: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/failed-emails/{id}/resolve',
  tags: ['admin'],
  summary: 'Mark a FailedEmail row as resolved',
  request: {
    body: {
      required: false,
      content: { 'application/json': { schema: ResolveFailedEmailBody } },
    },
  },
  responses: {
    200: {
      description: 'Resolved (or was already resolved)',
      content: { 'application/json': { schema: ResolveFailedEmailResponse } },
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
      description: 'No FailedEmail with that id',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
