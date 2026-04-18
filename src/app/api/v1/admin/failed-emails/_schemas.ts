import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// Admin surface for the FailedEmail sink (Step 23).
//
// GET /api/v1/admin/failed-emails — paginated list with optional
// `resolved` filter. Oldest-unresolved-first so oncall works a queue
// rather than the latest bad day.

export const ListFailedEmailsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
  resolved: z.enum(['true', 'false']).optional(),
})

export const FailedEmailRow = z.object({
  id: z.string(),
  toEmail: z.string(),
  template: z.string(),
  attempts: z.number().int(),
  lastError: z.string(),
  failedAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
})

export const ListFailedEmailsResponse = z.object({
  items: z.array(FailedEmailRow),
  nextCursor: z.string().nullable(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/failed-emails',
  tags: ['admin'],
  summary: 'List FailedEmail rows (oldest unresolved first)',
  request: { query: ListFailedEmailsQuery },
  responses: {
    200: {
      description: 'List of failed emails',
      content: { 'application/json': { schema: ListFailedEmailsResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    403: {
      description: 'Not an admin',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
