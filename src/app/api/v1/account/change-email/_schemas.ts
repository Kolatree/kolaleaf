import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Email, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const ChangeEmailBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newEmail: Email,
})

export const ChangeEmailResponse = z.object({
  sent: z.literal(true),
  newEmail: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/account/change-email',
  tags: ['account'],
  summary: 'Start an email-change flow; sends a verification code to the new address',
  request: {
    body: { required: true, content: { 'application/json': { schema: ChangeEmailBody } } },
  },
  responses: {
    200: {
      description: 'Code issued to new address',
      content: { 'application/json': { schema: ChangeEmailResponse } },
    },
    401: { description: 'invalid_credentials / unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'email_taken', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
