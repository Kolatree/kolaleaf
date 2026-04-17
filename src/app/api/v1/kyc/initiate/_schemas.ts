import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

// POST /api/v1/kyc/initiate — no request body. The Sumsub applicantId
// is derived from the authenticated session.

export const KycInitiateResponse = z.object({
  applicantId: z.string(),
  verificationUrl: z.string(),
})

registry.registerPath({
  method: 'post',
  path: '/kyc/initiate',
  tags: ['kyc'],
  summary: 'Kick off Sumsub KYC and return the verification URL',
  responses: {
    200: {
      description: 'Sumsub applicant created',
      content: { 'application/json': { schema: KycInitiateResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: { description: 'KYC already verified / in review', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
