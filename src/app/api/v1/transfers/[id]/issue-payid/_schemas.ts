import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { Cuid, ErrorEnvelope } from '@/lib/schemas/common'

export const IssuePayIdResponse = z.object({
  transfer: z
    .object({
      id: z.string(),
      status: z.string(),
      payidReference: z.string().nullable(),
      payidProviderRef: z.string().nullable(),
    })
    .passthrough(),
})

registry.registerPath({
  method: 'post',
  path: '/transfers/{id}/issue-payid',
  tags: ['transfers'],
  summary: 'Issue a PayID for a CREATED transfer (owner only)',
  request: { params: z.object({ id: Cuid }) },
  responses: {
    200: {
      description: 'PayID issued; transfer now AWAITING_AUD',
      content: { 'application/json': { schema: IssuePayIdResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: {
      description: 'Not the transfer owner, email unverified, or KYC not verified',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    404: { description: 'Transfer not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    409: {
      description: 'Transfer is not in CREATED state',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
