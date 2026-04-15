import { prisma } from '../db/client'
import type { Transfer, TransferEvent } from '../../generated/prisma/client'
import type { TransferStatus } from '../../generated/prisma/enums'
import { Prisma } from '../../generated/prisma/client'

// User-safe Transfer projection. NEVER includes provider refs, retry counts,
// or internal failure reasons — those are admin-only audit fields. Admin
// routes should query `prisma.transfer` directly (see
// `src/app/api/admin/transfers/[id]/route.ts`).
export interface TransferUserView {
  id: string
  status: TransferStatus
  sendAmount: Prisma.Decimal
  sendCurrency: string
  receiveAmount: Prisma.Decimal
  receiveCurrency: string
  exchangeRate: Prisma.Decimal
  fee: Prisma.Decimal
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
  recipient: TransferListRecipient | null
}

// Single source of truth for which Transfer columns user-facing routes are
// allowed to see. Reused by getTransfer and listTransfers so a future column
// added to the schema doesn't silently leak.
const USER_SAFE_TRANSFER_SELECT = {
  id: true,
  status: true,
  sendAmount: true,
  sendCurrency: true,
  receiveAmount: true,
  receiveCurrency: true,
  exchangeRate: true,
  fee: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  recipient: { select: { id: true, fullName: true, bankName: true } },
} satisfies Prisma.TransferSelect

export async function getTransfer(
  transferId: string,
  userId: string
): Promise<TransferUserView | null> {
  return prisma.transfer.findFirst({
    where: { id: transferId, userId },
    select: USER_SAFE_TRANSFER_SELECT,
  })
}

interface ListParams {
  status?: TransferStatus
  limit?: number
  cursor?: string
}

// The public, non-sensitive recipient fields we surface to the owner's
// transfer list. Account numbers and bank codes are intentionally omitted —
// the user already sees those on the /recipients page.
export interface TransferListRecipient {
  id: string
  fullName: string
  bankName: string
}

export type TransferWithRecipient = Transfer & {
  recipient: TransferListRecipient | null
}

interface ListResult {
  transfers: TransferWithRecipient[]
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
    include: {
      recipient: { select: { id: true, fullName: true, bankName: true } },
    },
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
