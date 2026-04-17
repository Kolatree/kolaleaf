import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const ResolveRecipientBody = z.object({
  bankCode: z.string().trim().min(1, 'bankCode is required'),
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, 'accountNumber must be 10 digits'),
})

export const ResolveRecipientResponse = z.object({
  accountName: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/recipients/resolve',
  tags: ['recipients'],
  summary: 'Resolve a bank account to its holder name via the payout provider',
  request: {
    body: { required: true, content: { 'application/json': { schema: ResolveRecipientBody } } },
  },
  responses: {
    200: {
      description: 'Account resolved',
      content: { 'application/json': { schema: ResolveRecipientResponse } },
    },
    400: { description: 'Malformed JSON', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'account_not_found', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
    429: { description: 'rate_limited', content: { 'application/json': { schema: ErrorEnvelope } } },
    503: { description: 'resolve_unavailable', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
