import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/banks?country=NG

export const BanksQuery = z.object({
  country: z.literal('NG'),
})

export const BanksResponse = z.object({
  banks: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
    }),
  ),
})

registry.registerPath({
  method: 'get',
  path: '/banks',
  tags: ['banks'],
  summary: 'List banks for a destination country',
  request: { query: BanksQuery },
  responses: {
    200: {
      description: 'Bank list',
      content: { 'application/json': { schema: BanksResponse } },
    },
    400: { description: 'unsupported_country', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    503: { description: 'banks_unavailable', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
