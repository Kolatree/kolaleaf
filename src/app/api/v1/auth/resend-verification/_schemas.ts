import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/resend-verification — enumeration-proof.

export const ResendVerificationBody = z.object({
  email: Email,
})

export const ResendVerificationResponse = z.object({ ok: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/auth/resend-verification',
  tags: ['auth'],
  summary: 'Resend an email-verification code (always 200)',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ResendVerificationBody } },
    },
  },
  responses: {
    200: {
      description: 'Handled (generic success)',
      content: { 'application/json': { schema: ResendVerificationResponse } },
    },
    400: {
      description: 'Malformed JSON',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})
