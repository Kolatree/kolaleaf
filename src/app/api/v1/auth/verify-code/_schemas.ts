import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, SixDigitCode, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/verify-code — step 2 of the verify-first wizard.

export const VerifyCodeBody = z.object({
  email: Email,
  code: SixDigitCode,
})

export const VerifyCodeResponse = z.object({ verified: z.literal(true) })

export type VerifyCodeBodyInput = z.infer<typeof VerifyCodeBody>

registry.registerPath({
  method: 'post',
  path: '/auth/verify-code',
  tags: ['auth'],
  summary: 'Validate a 6-digit wizard code and open the 30-min claim window',
  request: {
    body: { required: true, content: { 'application/json': { schema: VerifyCodeBody } } },
  },
  responses: {
    200: {
      description: 'Code valid; claim window opened',
      content: { 'application/json': { schema: VerifyCodeResponse } },
    },
    400: {
      description: 'Malformed JSON or code reason (wrong_code / expired / used / no_token)',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
    429: {
      description: 'Too many wrong attempts',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
