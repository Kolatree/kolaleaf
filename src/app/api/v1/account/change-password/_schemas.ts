import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Password, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: Password,
})

export const ChangePasswordResponse = z.object({ changed: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/account/change-password',
  tags: ['account'],
  summary: 'Rotate the password; force-logs-out every OTHER session',
  request: {
    body: { required: true, content: { 'application/json': { schema: ChangePasswordBody } } },
  },
  responses: {
    200: {
      description: 'Password changed',
      content: { 'application/json': { schema: ChangePasswordResponse } },
    },
    401: { description: 'invalid_credentials / unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
