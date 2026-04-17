import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const RemovePhoneBody = z.object({
  phone: z.string().min(1, 'Phone is required'),
})

export const RemovePhoneResponse = z.object({ removed: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/account/phone/remove',
  tags: ['account'],
  summary: 'Remove a phone identifier (blocked while SMS 2FA is active)',
  request: {
    body: { required: true, content: { 'application/json': { schema: RemovePhoneBody } } },
  },
  responses: {
    200: {
      description: 'Phone removed',
      content: { 'application/json': { schema: RemovePhoneResponse } },
    },
    400: { description: 'invalid_phone / cannot_remove_phone_while_2fa_active', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    404: { description: 'not_found', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
