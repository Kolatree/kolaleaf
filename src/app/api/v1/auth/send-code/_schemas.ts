import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/send-code
//
// Step 1 of the verify-first wizard: issue a 6-digit code to the
// target email. Enumeration-proof — always 200 regardless of whether
// the address is known / rate-limited / bounced. Schema failure
// (malformed email, missing field) is the only non-2xx signal and
// maps to 422 with `fields.email`.

export const SendCodeBody = z.object({
  email: Email,
})

export const SendCodeResponse = z.object({
  ok: z.literal(true),
})

export type SendCodeBodyInput = z.infer<typeof SendCodeBody>
export type SendCodeResponseOutput = z.infer<typeof SendCodeResponse>

registry.registerPath({
  method: 'post',
  path: '/auth/send-code',
  tags: ['auth'],
  summary: 'Send a 6-digit email verification code',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SendCodeBody } },
    },
  },
  responses: {
    200: {
      description: 'Code issued (or silently skipped for enumeration-proof reasons)',
      content: { 'application/json': { schema: SendCodeResponse } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
    400: {
      description: 'Malformed JSON',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
