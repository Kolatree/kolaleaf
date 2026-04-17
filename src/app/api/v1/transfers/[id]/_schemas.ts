import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const GetTransferResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'get',
  path: '/transfers/{id}',
  tags: ['transfers'],
  summary: 'Fetch a transfer owned by the current user',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Transfer detail',
      content: { 'application/json': { schema: GetTransferResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
