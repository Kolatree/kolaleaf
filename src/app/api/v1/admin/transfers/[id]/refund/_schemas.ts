import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const AdminRefundRequest = z.object({
  refundReference: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional(),
})

export const AdminRefundResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/transfers/{id}/refund',
  tags: ['admin', 'transfers'],
  summary: 'Mark a NEEDS_MANUAL transfer as manually refunded',
  request: {
    params: z.object({ id: Cuid }),
    body: {
      content: {
        'application/json': {
          schema: AdminRefundRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Transfer marked refunded with an external operator reference',
      content: { 'application/json': { schema: AdminRefundResponse } },
    },
    400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Invalid transition', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
