import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { PaginationQuery, ErrorEnvelope } from '@/lib/schemas/common'

export const AdminTransfersQuery = PaginationQuery.extend({
  status: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const AdminTransfersListResponse = z.object({
  transfers: z.array(z.object({ id: z.string() }).passthrough()),
  nextCursor: z.string().optional(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/transfers',
  tags: ['admin', 'transfers'],
  summary: 'List transfers across all users (cursor-paginated)',
  request: { query: AdminTransfersQuery },
  responses: {
    200: {
      description: 'Transfers page',
      content: { 'application/json': { schema: AdminTransfersListResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
