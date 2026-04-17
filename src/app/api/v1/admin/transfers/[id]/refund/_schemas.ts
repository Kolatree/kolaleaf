import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

// No request body — the admin only needs the transferId + current state.

export const AdminRefundResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/transfers/{id}/refund',
  tags: ['admin', 'transfers'],
  summary: 'Force-refund a NEEDS_MANUAL transfer',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Transfer refunded',
      content: { 'application/json': { schema: AdminRefundResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Invalid transition', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
