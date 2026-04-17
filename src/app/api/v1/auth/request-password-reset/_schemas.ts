import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/request-password-reset — enumeration-proof.

export const RequestPasswordResetBody = z.object({
  email: Email,
})

export const RequestPasswordResetResponse = z.object({ message: z.string() })

registry.registerPath({
  method: 'post',
  path: '/auth/request-password-reset',
  tags: ['auth'],
  summary: 'Request a password-reset email (always 200 to avoid enumeration)',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: RequestPasswordResetBody } },
    },
  },
  responses: {
    200: {
      description: 'Generic success regardless of whether the email exists',
      content: { 'application/json': { schema: RequestPasswordResetResponse } },
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
