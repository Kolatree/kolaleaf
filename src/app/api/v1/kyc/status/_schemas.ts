import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

export const KycStatusResponse = z
  .object({
    status: z.string(),
  })
  .passthrough()

registry.registerPath({
  method: 'get',
  path: '/kyc/status',
  tags: ['kyc'],
  summary: 'Get the current user\'s KYC status',
  responses: {
    200: {
      description: 'KYC status',
      content: { 'application/json': { schema: KycStatusResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
