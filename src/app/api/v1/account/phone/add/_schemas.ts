import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// The phone format is normalised by `normalizePhone` — the schema only
// enforces "non-empty string". Stricter E.164 validation stays in the
// helper so national-number inputs still parse cleanly.
export const AddPhoneBody = z.object({
  phone: z.string().min(1, 'Phone is required'),
})

export const AddPhoneResponse = z.object({ sent: z.literal(true) })

registry.registerPath({
  method: 'post',
  path: '/account/phone/add',
  tags: ['account'],
  summary: 'Add a phone identifier and issue an SMS verification code',
  request: {
    body: { required: true, content: { 'application/json': { schema: AddPhoneBody } } },
  },
  responses: {
    200: {
      description: 'SMS code issued',
      content: { 'application/json': { schema: AddPhoneResponse } },
    },
    400: { description: 'invalid_phone', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'phone_taken', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
    429: { description: 'rate_limited', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
