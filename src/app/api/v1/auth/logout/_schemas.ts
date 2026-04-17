import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/logout — no body, no query. Just exists in the
// OpenAPI document so Wave 2 codegen sees the full auth surface.

export const LogoutResponse = z.object({ success: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'Revoke the current session',
  responses: {
    200: {
      description: 'Session revoked; cookie cleared',
      content: { 'application/json': { schema: LogoutResponse } },
    },
    500: {
      description: 'Unexpected failure',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
