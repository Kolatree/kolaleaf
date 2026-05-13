import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

export const KycAccessTokenResponse = z.object({
  applicantId: z.string(),
  accessToken: z.string(),
  verificationUrl: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/kyc/access-token',
  tags: ['kyc'],
  summary: 'Mint a fresh Sumsub WebSDK access token for an in-review applicant',
  responses: {
    200: {
      description: 'Fresh Sumsub WebSDK token',
      content: { 'application/json': { schema: KycAccessTokenResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    409: {
      description: 'No active KYC application, or KYC is already verified',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    500: {
      description: 'Access-token minting failed unexpectedly',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
