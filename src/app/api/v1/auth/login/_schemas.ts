import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/auth/login
//
// `identifier` intentionally stays as a bare non-empty string — today it
// is an email, but Step 21 replaces this with a discriminated-union
// identifier body (email | phone | apple | google). Keeping the schema
// loose here avoids a breaking contract churn when 21 lands.

export const LoginBody = z.object({
  identifier: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
})

export const LoginResponse = z.object({
  user: z.object({ id: z.string(), fullName: z.string().nullable() }),
  requires2FA: z.boolean(),
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
