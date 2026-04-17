import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const Disable2faBody = z.object({
  code: z.string().min(1, 'A verification code is required'),
  challengeId: z.string().optional(),
})

export const Disable2faResponse = z.object({ disabled: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/account/2fa/disable',
  tags: ['account', '2fa'],
  summary: 'Disable 2FA (requires current TOTP / SMS challenge / backup code)',
  request: {
    body: { required: true, content: { 'application/json': { schema: Disable2faBody } } },
  },
  responses: {
    200: {
      description: '2FA disabled; other sessions invalidated',
      content: { 'application/json': { schema: Disable2faResponse } },
    },
    400: { description: 'not_enabled / invalid_code', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
