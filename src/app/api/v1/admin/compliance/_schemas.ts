import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { PaginationQuery, ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/admin/compliance — list compliance reports (paginated).
// Query-only; no request body to migrate.

export const AdminComplianceQuery = PaginationQuery.extend({
  type: z.string().optional(),
})

export const AdminComplianceResponse = z.object({
  reports: z.array(z.object({ id: z.string() }).passthrough()),
  nextCursor: z.string().optional(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/compliance',
  tags: ['admin', 'compliance'],
  summary: 'List compliance reports (cursor-paginated)',
  request: { query: AdminComplianceQuery },
  responses: {
    200: {
      description: 'Reports page',
      content: { 'application/json': { schema: AdminComplianceResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
