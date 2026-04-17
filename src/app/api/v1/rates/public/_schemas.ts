import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { CurrencyCode, ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/rates/public?base=AUD&target=NGN — public, cacheable.
// Both currency codes are uppercase ISO 4217.

export const PublicRateQuery = z.object({
  base: CurrencyCode,
  target: CurrencyCode,
})

export const PublicRateResponse = z.object({
  baseCurrency: z.string(),
  targetCurrency: z.string(),
  corridorId: z.string(),
  customerRate: z.string(),
  effectiveAt: z.string(),
})

registry.registerPath({
  method: 'get',
  path: '/rates/public',
  tags: ['rates'],
  summary: 'Public rate lookup by ISO currency pair',
  request: { query: PublicRateQuery },
  responses: {
    200: {
      description: 'Current rate for the pair',
      content: { 'application/json': { schema: PublicRateResponse } },
    },
    400: { description: 'Missing query param', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'corridor_not_found', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
