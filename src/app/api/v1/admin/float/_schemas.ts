import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/admin/float — wallet float balance for the current payout
// provider. Read-only; no request body.

export const AdminFloatResponse = z.object({
  float: z.object({
    provider: z.string(),
    balance: z.string(),
    sufficient: z.boolean(),
    threshold: z.string(),
  }),
})

registry.registerPath({
  method: 'get',
  path: '/admin/float',
  tags: ['admin'],
  summary: 'Current payout-provider float balance',
  responses: {
    200: {
      description: 'Float status',
      content: { 'application/json': { schema: AdminFloatResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
