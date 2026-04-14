import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  prisma,
  registerTestUser,
  createTestRecipient,
  createTestTransfer,
  getTestCorridorId,
  getTestCorridor,
  cleanupTestData,
} from '../e2e/helpers'
import { createTransfer } from '../../src/lib/transfers/create'
import { cancelTransfer } from '../../src/lib/transfers/cancel'
import { getTransfer, listTransfers } from '../../src/lib/transfers/queries'
import {
  KycNotVerifiedError,
  AmountOutOfRangeError,
  DailyLimitExceededError,
  NotTransferOwnerError,
  RecipientNotOwnedError,
} from '../../src/lib/transfers/errors'
import Decimal from 'decimal.js'

let corridorId: string

beforeAll(async () => {
  await cleanupTestData()
  corridorId = await getTestCorridorId()
})

afterEach(async () => {
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
  await prisma.recipient.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

describe('Transfer Security', () => {
  it('user can only see own transfers — getTransfer returns null for another user', async () => {
    const { user: userA } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const { user: userB } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipientA = await createTestRecipient(userA.id)

    const transfer = await createTestTransfer(userA.id, recipientA.id, {
      sendAmount: 200,
    })

    // User A can see their own transfer
    const visibleToA = await getTransfer(transfer.id, userA.id)
    expect(visibleToA).not.toBeNull()
    expect(visibleToA!.id).toBe(transfer.id)

    // User B CANNOT see User A's transfer
    const visibleToB = await getTransfer(transfer.id, userB.id)
    expect(visibleToB).toBeNull()
  })

  it('listTransfers only returns transfers belonging to the calling user', async () => {
    const { user: userA } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const { user: userB } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipientA = await createTestRecipient(userA.id)
    const recipientB = await createTestRecipient(userB.id)

    // Create transfers for both users
    await createTestTransfer(userA.id, recipientA.id, { sendAmount: 100 })
    await createTestTransfer(userA.id, recipientA.id, { sendAmount: 200 })
    await createTestTransfer(userB.id, recipientB.id, { sendAmount: 300 })

    // User A sees only their 2 transfers
    const resultA = await listTransfers(userA.id)
    expect(resultA.transfers).toHaveLength(2)
    expect(resultA.transfers.every((t) => t.userId === userA.id)).toBe(true)

    // User B sees only their 1 transfer
    const resultB = await listTransfers(userB.id)
    expect(resultB.transfers).toHaveLength(1)
    expect(resultB.transfers[0].userId).toBe(userB.id)
  })

  it('user can only cancel own transfers — NotTransferOwnerError for another user', async () => {
    const { user: userA } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const { user: userB } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipientA = await createTestRecipient(userA.id)

    const transfer = await createTestTransfer(userA.id, recipientA.id, {
      status: 'CREATED',
    })

    // User B tries to cancel User A's transfer
    await expect(
      cancelTransfer({ transferId: transfer.id, userId: userB.id })
    ).rejects.toThrow(NotTransferOwnerError)

    // User A can cancel their own transfer
    const cancelled = await cancelTransfer({ transferId: transfer.id, userId: userA.id })
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('KYC-unverified user cannot create transfer', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })
    const recipient = await createTestRecipient(user.id)

    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(KycNotVerifiedError)
  })

  it('IN_REVIEW KYC status also cannot create transfer', async () => {
    const { user } = await registerTestUser({ kycStatus: 'IN_REVIEW' })
    const recipient = await createTestRecipient(user.id)

    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(KycNotVerifiedError)
  })

  it('transfer amount below corridor minimum is rejected', async () => {
    const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipient = await createTestRecipient(user.id)
    const corridor = await getTestCorridor()

    const belowMin = new Decimal(corridor.minAmount.toString()).minus(1)

    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: belowMin,
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(AmountOutOfRangeError)
  })

  it('transfer amount above corridor maximum is rejected', async () => {
    const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipient = await createTestRecipient(user.id)
    const corridor = await getTestCorridor()

    const aboveMax = new Decimal(corridor.maxAmount.toString()).plus(1)

    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: aboveMax,
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(AmountOutOfRangeError)
  })

  it('daily limit enforcement — exceeding limit is rejected', async () => {
    const { user } = await registerTestUser({ kycStatus: 'VERIFIED', dailyLimit: 1000 })
    const recipient = await createTestRecipient(user.id)

    // First transfer of 600 succeeds
    const t1 = await createTransfer({
      userId: user.id,
      recipientId: recipient.id,
      corridorId,
      sendAmount: new Decimal(600),
      exchangeRate: new Decimal(1042.65),
      fee: new Decimal(5),
    })
    expect(t1.status).toBe('CREATED')

    // Second transfer of 600 would total 1200, exceeding 1000 daily limit
    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: new Decimal(600),
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(DailyLimitExceededError)
  })

  it('user cannot create transfer with another user\'s recipient', async () => {
    const { user: userA } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const { user: userB } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipientA = await createTestRecipient(userA.id)

    // User B tries to use User A's recipient
    await expect(
      createTransfer({
        userId: userB.id,
        recipientId: recipientA.id,
        corridorId,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(RecipientNotOwnedError)
  })
})
