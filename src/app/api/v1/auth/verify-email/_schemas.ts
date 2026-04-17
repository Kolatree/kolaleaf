import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, SixDigitCode, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/verify-email — post-registration email verification
// path (sets a session on success). GET is a legacy HTML redirect and
// is not described in the OpenAPI spec — it serves inbox links from
// pre-wizard users, not a programmatic client.

export const VerifyEmailBody = z.object({
  email: Email,
  code: SixDigitCode,
})

export const VerifyEmailResponse = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string(), fullName: z.string().nullable().optional() }),
})

export type VerifyEmailBodyInput = z.infer<typeof VerifyEmailBody>

registry.registerPath({
  method: 'post',
  path: '/auth/verify-email',
  tags: ['auth'],
  summary: 'Verify an email with a 6-digit code and open a session',
  request: {
    body: { required: true, content: { 'application/json': { schema: VerifyEmailBody } } },
  },
  responses: {
    200: {
      description: 'Email verified; session cookie set',
      content: { 'application/json': { schema: VerifyEmailResponse } },
    },
    400: {
      description: 'Malformed JSON or verification reason',
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
