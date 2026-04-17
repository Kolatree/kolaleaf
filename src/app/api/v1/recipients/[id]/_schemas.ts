import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const DeleteRecipientResponse = z.object({ success: z.literal(true) })

registry.registerPath({
  method: 'delete',
  path: '/recipients/{id}',
  tags: ['recipients'],
  summary: 'Delete a recipient owned by the current user',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: DeleteRecipientResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not owner', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Recipient not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
