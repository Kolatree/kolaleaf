import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const Setup2faBody = z.object({
  method: z.enum(['TOTP', 'SMS']),
})

// TOTP branch returns secret + QR; SMS branch returns challengeId. We
// use a union here so the OpenAPI doc surfaces both shapes.
export const Setup2faResponse = z.union([
  z.object({
    method: z.literal('TOTP'),
    secret: z.string(),
    otpauthUri: z.string(),
    qrDataUrl: z.string(),
  }),
  z.object({
    method: z.literal('SMS'),
    challengeId: z.string(),
  }),
])

registry.registerPath({
  method: 'post',
  path: '/account/2fa/setup',
  tags: ['account', '2fa'],
  summary: 'Kick off 2FA enrollment (TOTP or SMS)',
  request: {
    body: { required: true, content: { 'application/json': { schema: Setup2faBody } } },
  },
  responses: {
    200: {
      description: 'Secret + QR (TOTP) or challengeId (SMS)',
      content: { 'application/json': { schema: Setup2faResponse } },
    },
    400: {
      description: 'invalid_method / already_enabled / phone_not_verified',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
