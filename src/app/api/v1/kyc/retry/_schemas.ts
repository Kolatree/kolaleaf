import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/kyc/retry
//
// Only valid when User.kycStatus is REJECTED. Reuses the existing
// Sumsub applicantId to mint a fresh access token and resets the
// user to IN_REVIEW. This is the route that was missing in the
// Wave 1 audit (kyc.md §P0 gap #1) — a REJECTED user otherwise
// has no in-app path forward.

export const RetryKycResponse = z.object({
  accessToken: z.string(),
  verificationUrl: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/kyc/retry',
  tags: ['kyc'],
  summary: 'Re-initiate a REJECTED KYC application with a fresh access token',
  responses: {
    200: {
      description: 'Fresh Sumsub access token + URL; user is now IN_REVIEW',
      content: { 'application/json': { schema: RetryKycResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    409: {
      description: 'KYC is not REJECTED — retry is only valid for rejected applications',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
