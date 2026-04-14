import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../src/generated/prisma/client'
import { TransferStatus, ActorType } from '../../../src/generated/prisma/enums'
import Decimal from 'decimal.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
export const prisma = new PrismaClient({ adapter })

let corridorId: string

export async function getTestCorridorId(): Promise<string> {
  if (corridorId) return corridorId
  const corridor = await prisma.corridor.findUniqueOrThrow({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
  })
  corridorId = corridor.id
  return corridorId
}

export async function createTestUser(overrides: {
  kycStatus?: 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED'
  dailyLimit?: number
} = {}) {
  return prisma.user.create({
    data: {
      fullName: 'Test User',
      kycStatus: overrides.kycStatus ?? 'VERIFIED',
      dailyLimit: overrides.dailyLimit ?? 10000,
    },
  })
}

export async function createTestRecipient(userId: string) {
  return prisma.recipient.create({
    data: {
      userId,
      fullName: 'Test Recipient',
      bankName: 'GTBank',
      bankCode: '058',
      accountNumber: '0123456789',
    },
  })
}

export async function createTestTransfer(
  userId: string,
  recipientId: string,
  overrides: {
    status?: TransferStatus
    sendAmount?: number
    retryCount?: number
  } = {}
) {
  const cId = await getTestCorridorId()
  const transfer = await prisma.transfer.create({
    data: {
      userId,
      recipientId,
      corridorId: cId,
      sendAmount: overrides.sendAmount ?? 500,
      receiveAmount: new Decimal(overrides.sendAmount ?? 500).mul(1042.65),
      exchangeRate: 1042.65,
      fee: 5,
      status: overrides.status ?? 'CREATED',
      retryCount: overrides.retryCount ?? 0,
    },
  })

  // Create initial event for non-CREATED statuses to maintain audit trail
  await prisma.transferEvent.create({
    data: {
      transferId: transfer.id,
      fromStatus: 'CREATED',
      toStatus: overrides.status ?? 'CREATED',
      actor: 'SYSTEM',
    },
  })

  return transfer
}

export async function cleanupTestData() {
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
  await prisma.recipient.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
}
