import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

// Optional `amount` override — when omitted, the route uses the
// transfer's own sendAmount so stub-mode testers don't need to know
// the amount. String-typed so decimal.js can parse without precision
// loss.
export const SimulatePaymentBody = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
})

export const SimulatePaymentResponse = z.object({
  transfer: z.object({ id: z.string(), status: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/transfers/{id}/simulate-payment',
  tags: ['admin', 'transfers'],
  summary: 'Dev/stub trigger for AWAITING_AUD → AUD_RECEIVED (hidden in prod unless stub flag is on)',
  request: {
    params: z.object({ id: Cuid }),
    body: {
      content: { 'application/json': { schema: SimulatePaymentBody } },
    },
  },
  responses: {
    200: {
      description: 'Payment simulated; transfer cascades per stub-mode rules',
      content: { 'application/json': { schema: SimulatePaymentResponse } },
    },
    400: { description: 'Invalid amount / amount mismatch', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'Transfer not found or route disabled in production', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'Transfer is not in AWAITING_AUD state', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
