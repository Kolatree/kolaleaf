import { prisma } from '../db/client'
import type { Transfer, TransferEvent } from '../../generated/prisma/client'
import type { TransferStatus } from '../../generated/prisma/enums'

export async function getTransfer(
  transferId: string,
  userId: string
): Promise<Transfer | null> {
  return prisma.transfer.findFirst({
    where: { id: transferId, userId },
  })
}

interface ListParams {
  status?: TransferStatus
  limit?: number
  cursor?: string
}

interface ListResult {
  transfers: Transfer[]
  nextCursor?: string
}

export async function listTransfers(
  userId: string,
  params: ListParams = {}
): Promise<ListResult> {
  const limit = params.limit ?? 20
  const where: Record<string, unknown> = { userId }
  if (params.status) where.status = params.status

  const transfers = await prisma.transfer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(params.cursor
      ? { skip: 1, cursor: { id: params.cursor } }
      : {}),
  })

  const hasMore = transfers.length > limit
  const page = hasMore ? transfers.slice(0, limit) : transfers
  const nextCursor = hasMore ? page[page.length - 1].id : undefined

  return { transfers: page, nextCursor }
}

export async function getTransferWithEvents(
  transferId: string
): Promise<Transfer & { events: TransferEvent[] }> {
  const transfer = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  return transfer
}
