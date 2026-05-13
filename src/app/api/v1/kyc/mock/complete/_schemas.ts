import { z } from 'zod'

export const CompleteMockKycBody = z.object({
  outcome: z.enum(['approve', 'reject']),
})
