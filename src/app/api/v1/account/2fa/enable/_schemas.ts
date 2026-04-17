import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// Method-discriminated enable body. TOTP needs `secret` echoed back
// from /setup; SMS needs `challengeId` from /setup. Zod's
// discriminatedUnion gives a crisp 422 when the wrong field set is
// supplied for the chosen method.
export const Enable2faBody = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('TOTP'),
    secret: z.string().min(1, 'Secret is required for TOTP'),
    code: z.string().min(1, 'Code is required'),
  }),
  z.object({
    method: z.literal('SMS'),
    challengeId: z.string().min(1, 'challengeId is required for SMS'),
    code: z.string().min(1, 'Code is required'),
  }),
])

export const Enable2faResponse = z.object({
  enabled: z.literal(true),
  backupCodes: z.array(z.string()),
})

registry.registerPath({
  method: 'post',
  path: '/account/2fa/enable',
  tags: ['account', '2fa'],
  summary: 'Commit a 2FA enrollment started by /setup',
  request: {
    body: { required: true, content: { 'application/json': { schema: Enable2faBody } } },
  },
  responses: {
    200: {
      description: '2FA enabled; raw backup codes returned (once)',
      content: { 'application/json': { schema: Enable2faResponse } },
    },
    400: { description: 'already_enabled / invalid_code', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
