import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Password, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/reset-password

export const ResetPasswordBody = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: Password,
})

export const ResetPasswordResponse = z.object({ ok: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/auth/reset-password',
  tags: ['auth'],
  summary: 'Consume a reset token and set a new password',
  request: {
    body: { required: true, content: { 'application/json': { schema: ResetPasswordBody } } },
  },
  responses: {
    200: {
      description: 'Password rotated; all sessions invalidated',
      content: { 'application/json': { schema: ResetPasswordResponse } },
    },
    400: {
      description: 'Malformed JSON or token expired / used',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})
