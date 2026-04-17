import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope } from '@/lib/schemas/common'

export const AdminStatsResponse = z.object({
  stats: z.object({
    transfersToday: z.number().int(),
    volumeTodayAud: z.string(),
    activeUsers: z.number().int(),
    pendingKyc: z.number().int(),
    transfersByStatus: z.record(z.string(), z.number()),
  }),
})

registry.registerPath({
  method: 'get',
  path: '/admin/stats',
  tags: ['admin'],
  summary: 'Ops dashboard summary stats',
  responses: {
    200: {
      description: 'Dashboard stats',
      content: { 'application/json': { schema: AdminStatsResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    403: { description: 'Not an admin', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
