import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import {
  Cuid,
  DecimalString,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from '@/lib/schemas/common'

// GET  /api/v1/admin/rates — list current rates for active corridors
// POST /api/v1/admin/rates — override the customer + wholesale rate for a corridor

export const SetAdminRateBody = z.object({
  corridorId: Cuid,
  customerRate: DecimalString,
  wholesaleRate: DecimalString,
})

const CorridorShape = z.object({
  id: z.string(),
  baseCurrency: z.string(),
  targetCurrency: z.string(),
})

const RateShape = z.object({
  id: z.string(),
  corridorId: z.string(),
  customerRate: z.string(),
  wholesaleRate: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
})

export const ListAdminRatesResponse = z.object({
  rates: z.array(
    z.object({
      corridor: CorridorShape,
      currentRate: RateShape.nullable(),
      stale: z.boolean(),
      hoursStale: z.number().nullable(),
      history: z.array(RateShape),
    }),
  ),
})

export const SetAdminRateResponse = z.object({ rate: RateShape })

export type SetAdminRateInput = z.infer<typeof SetAdminRateBody>

registry.registerPath({
  method: 'get',
  path: '/admin/rates',
  tags: ['admin', 'rates'],
  summary: 'List current + historical rates for every active corridor',
  responses: {
    200: {
      description: 'Rate + staleness info per corridor',
      content: { 'application/json': { schema: ListAdminRatesResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    403: {
      description: 'Not an admin',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/rates',
  tags: ['admin', 'rates'],
  summary: 'Override the customer + wholesale rate for a corridor',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SetAdminRateBody } },
    },
  },
  responses: {
    201: {
      description: 'Rate override stored + audit-logged',
      content: { 'application/json': { schema: SetAdminRateResponse } },
    },
    400: {
      description: 'Malformed JSON',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    403: {
      description: 'Not an admin',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})
