import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// GET /api/v1/account/me — response-only schema. No request body / query.
//
// Exercises the response-schema code path: OpenAPI lists the 200 shape
// so Wave-2 codegen sees the same type the /account page consumes.

const EmailIdentifier = z.object({
  id: z.string(),
  email: z.string(),
  verified: z.boolean(),
})

export const AccountMeResponse = z.object({
  userId: z.string(),
  fullName: z.string().nullable(),
  email: EmailIdentifier.nullable(),
  secondaryEmails: z.array(EmailIdentifier),
  twoFactorMethod: z.string().nullable(),
  twoFactorEnabledAt: z.string().nullable(),
  hasVerifiedPhone: z.boolean(),
  phoneMasked: z.string().nullable(),
  hasRemainingBackupCodes: z.boolean(),
  backupCodesRemaining: z.number().int(),
})

export type AccountMeResponseOutput = z.infer<typeof AccountMeResponse>

registry.registerPath({
  method: 'get',
  path: '/account/me',
  tags: ['account'],
  summary: 'Get the authenticated user account summary',
  responses: {
    200: {
      description: 'Account summary',
      content: { 'application/json': { schema: AccountMeResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
