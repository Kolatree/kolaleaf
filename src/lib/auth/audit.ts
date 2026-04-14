import { prisma } from '@/lib/db/client'
import { Prisma } from '@/generated/prisma/client'

interface LogAuthEventParams {
  userId: string
  event: string
  ip?: string
  metadata?: Record<string, unknown>
}

export async function logAuthEvent(params: LogAuthEventParams): Promise<void> {
  await prisma.authEvent.create({
    data: {
      userId: params.userId,
      event: params.event,
      ip: params.ip,
      metadata: params.metadata
        ? (params.metadata as Prisma.InputJsonValue)
        : Prisma.NullableJsonNullValueInput.DbNull,
    },
  })
}
