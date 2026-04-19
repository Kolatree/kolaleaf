import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import {
  Email,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from '@/lib/schemas/common'

// POST /api/v1/auth/login
//
// Step 21: `identifier` is now a discriminated-union object with
// `type` + `value`. Only `type: 'email'` is implemented today —
// Apple/Google sign-in will widen this schema when those routes
// land. Keeping the body narrow prevents advertising OAuth types
// we don't actually authenticate.

export const LoginIdentifier = z.object({
  type: z.literal('email'),
  value: Email,
})

export const LoginBody = z.object({
  identifier: LoginIdentifier,
  password: z.string().min(1, 'Password is required'),
})

export const LoginResponse = z.object({
  user: z.object({ id: z.string(), fullName: z.string().nullable() }),
  requires2FA: z.boolean(),
  twoFactorMethod: z.enum(['NONE', 'TOTP', 'SMS']).optional(),
})

export const LoginVerificationRequiredResponse = z.object({
  requiresVerification: z.literal(true),
  email: z.string(),
  message: z.string(),
})

export type LoginBodyInput = z.infer<typeof LoginBody>

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Authenticate with identifier + password',
  request: {
    body: { required: true, content: { 'application/json': { schema: LoginBody } } },
  },
  responses: {
    200: {
      description: 'Signed in (cookie set)',
      content: { 'application/json': { schema: LoginResponse } },
    },
    202: {
      description: 'Password OK but email unverified — code issued',
      content: { 'application/json': { schema: LoginVerificationRequiredResponse } },
    },
    400: {
      description: 'Malformed JSON',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    401: {
      description: 'Bad credentials',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})
