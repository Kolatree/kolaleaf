import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const AdminRetryResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/transfers/{id}/retry',
  tags: ['admin', 'transfers'],
  summary: 'Retry a NEEDS_MANUAL transfer (route to PROCESSING_NGN)',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Transfer transitioned',
      content: { 'application/json': { schema: AdminRetryResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Invalid transition', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
