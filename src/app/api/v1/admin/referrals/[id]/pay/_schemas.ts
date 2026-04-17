import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, DecimalString, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const PayReferralBody = z.object({
  amount: DecimalString,
})

export const PayReferralResponse = z.object({
  referral: z.object({ id: z.string() }).passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/admin/referrals/{id}/pay',
  tags: ['admin', 'referrals'],
  summary: 'Pay a referral reward',
  request: {
    params: z.object({ id: Cuid }),
    body: { required: true, content: { 'application/json': { schema: PayReferralBody } } },
  },
  responses: {
    200: {
      description: 'Reward processed',
      content: { 'application/json': { schema: PayReferralResponse } },
    },
    400: { description: 'Malformed JSON', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
