import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { SixDigitCode, ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const VerifyPhoneBody = z.object({
  phone: z.string().min(1, 'Phone is required'),
  code: SixDigitCode,
})

export const VerifyPhoneResponse = z.object({ verified: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/account/phone/verify',
  tags: ['account'],
  summary: 'Consume an SMS code and mark the phone identifier verified',
  request: {
    body: { required: true, content: { 'application/json': { schema: VerifyPhoneBody } } },
  },
  responses: {
    200: {
      description: 'Phone verified',
      content: { 'application/json': { schema: VerifyPhoneResponse } },
    },
    400: { description: 'invalid_phone / invalid_code', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'too_many_attempts', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
