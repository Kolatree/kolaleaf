import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const AdminTransferDetailResponse = z.object({
  transfer: z
    .object({
      id: z.string(),
      status: z.string(),
      events: z.array(z.unknown()),
      user: z.object({ id: z.string(), fullName: z.string().nullable() }).optional(),
      recipient: z
        .object({ id: z.string(), fullName: z.string(), bankName: z.string() })
        .optional(),
    })
    .passthrough(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/transfers/{id}',
  tags: ['admin', 'transfers'],
  summary: 'Fetch a single transfer with event history',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Transfer detail',
      content: { 'application/json': { schema: AdminTransferDetailResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
