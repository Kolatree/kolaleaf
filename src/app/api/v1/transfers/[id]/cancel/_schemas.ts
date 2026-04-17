import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const CancelTransferResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/transfers/{id}/cancel',
  tags: ['transfers'],
  summary: 'Cancel a user-owned transfer (pre-AUD-received window only)',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Transfer cancelled',
      content: { 'application/json': { schema: CancelTransferResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not owner', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Invalid transition', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
