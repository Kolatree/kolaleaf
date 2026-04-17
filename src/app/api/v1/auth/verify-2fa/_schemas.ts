import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/verify-2fa — one of:
//   { code }                  TOTP code OR backup code
//   { code, challengeId }     SMS challenge
//
// Schema is permissive on the pair so existing business logic decides
// which branch to run. Only `code` is required.

export const Verify2faBody = z.object({
  code: z.string().min(1, 'A verification code is required'),
  challengeId: z.string().optional(),
})

export const Verify2faResponse = z.object({
  verified: z.literal(true),
  backupCodeUsed: z.boolean().optional(),
  remaining: z.number().int().optional(),
})

export type Verify2faBodyInput = z.infer<typeof Verify2faBody>

registry.registerPath({
  method: 'post',
  path: '/auth/verify-2fa',
  tags: ['auth', '2fa'],
  summary: 'Verify a TOTP / SMS / backup 2FA code for the current session',
  request: {
    body: { required: true, content: { 'application/json': { schema: Verify2faBody } } },
  },
  responses: {
    200: {
      description: '2FA verified',
      content: { 'application/json': { schema: Verify2faResponse } },
    },
    400: {
      description: 'Malformed JSON or 2FA not enabled',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    401: {
      description: 'Unauthenticated or wrong code',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})
