import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// DELETE /api/v1/account/email/{id} — path-parameter only, no body.

export const DeleteEmailResponse = z.object({ removed: z.literal(true) })

registry.registerPath({
  method: 'delete',
  path: '/account/email/{id}',
  tags: ['account'],
  summary: 'Remove a secondary email identifier',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Identifier removed',
      content: { 'application/json': { schema: DeleteEmailResponse } },
    },
    400: { description: 'cannot_remove_only_email', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'not_found', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
