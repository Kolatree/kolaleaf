import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const RegenerateBackupCodesBody = z.object({
  code: z.string().min(1, 'A verification code is required'),
  challengeId: z.string().optional(),
})

export const RegenerateBackupCodesResponse = z.object({
  backupCodes: z.array(z.string()),
})

registry.registerPath({
  method: 'post',
  path: '/account/2fa/regenerate-backup-codes',
  tags: ['account', '2fa'],
  summary: 'Rotate 2FA backup codes; returns new raw codes once',
  request: {
    body: { required: true, content: { 'application/json': { schema: RegenerateBackupCodesBody } } },
  },
  responses: {
    200: {
      description: 'Codes rotated',
      content: { 'application/json': { schema: RegenerateBackupCodesResponse } },
    },
    400: { description: 'not_enabled / invalid_code', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})
