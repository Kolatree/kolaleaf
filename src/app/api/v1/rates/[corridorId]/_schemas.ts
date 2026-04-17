import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/rates/{corridorId} — deprecated internal route. Kept for
// the OpenAPI doc so legacy callers can still see its shape.

export const RateByCorridorResponse = z.object({
  corridorId: z.string(),
  customerRate: z.string(),
  effectiveAt: z.string(),
})

registry.registerPath({
  method: 'get',
  path: '/rates/{corridorId}',
  tags: ['rates'],
  summary: 'Deprecated: get a rate by corridor id',
  description: 'Prefer /rates/public?base=...&target=... for new code.',
  request: { params: z.object({ corridorId: Cuid }) },
  responses: {
    200: {
      description: 'Rate for the corridor',
      content: { 'application/json': { schema: RateByCorridorResponse } },
    },
    404: { description: 'No rate available', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
