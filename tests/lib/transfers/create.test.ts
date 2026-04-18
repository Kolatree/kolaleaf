import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { createTransfer } from '../../../src/lib/transfers/create'
import {
  InvalidCorridorError,
  AmountOutOfRangeError,
  DailyLimitExceededError,
  RecipientNotOwnedError,
} from '../../../src/lib/transfers/errors'
import {
  prisma,
  createTestUser,
  createTestRecipient,
  getTestCorridorId,
  cleanupTestData,
} from './helpers'

let verifiedUserId: string
let recipientId: string
let corridorId: string

beforeAll(async () => {
  await cleanupTestData()
  const user = await createTestUser({ kycStatus: 'VERIFIED', dailyLimit: 10000 })
  verifiedUserId = user.id
  const recipient = await createTestRecipient(verifiedUserId)
  recipientId = recipient.id
  corridorId = await getTestCorridorId()
})

afterEach(async () => {
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

describe('createTransfer', () => {
  it('creates a transfer with status CREATED and correct amounts', async () => {
    const transfer = await createTransfer({
      userId: verifiedUserId,
      recipientId,
      corridorId,
      sendAmount: new Decimal(500),
      exchangeRate: new Decimal('1042.65'),
      fee: new Decimal(5),
    })

    expect(transfer.status).toBe('CREATED')
    expect(new Decimal(transfer.sendAmount).toNumber()).toBe(500)
    expect(new Decimal(transfer.receiveAmount).toNumber()).toBe(new Decimal(500).mul('1042.65').toNumber())
    expect(new Decimal(transfer.fee).toNumber()).toBe(5)
    expect(transfer.userId).toBe(verifiedUserId)
    expect(transfer.recipientId).toBe(recipientId)
    expect(transfer.corridorId).toBe(corridorId)
  })

  it('creates initial TransferEvent (NULL_STATE -> CREATED, actor: USER)', async () => {
    const transfer = await createTransfer({
      userId: verifiedUserId,
      recipientId,
      corridorId,
      sendAmount: new Decimal(100),
      exchangeRate: new Decimal('1042.65'),
      fee: new Decimal(5),
    })

    const events = await prisma.transferEvent.findMany({
      where: { transferId: transfer.id },
    })
    expect(events.length).toBe(1)
    // Step 31 / audit gap #5: initial event is NULL_STATE -> CREATED
    // so AUSTRAC reconciliation sees monotone state progression,
    // not a misleading self-transition.
    expect(events[0].fromStatus).toBe('NULL_STATE')
    expect(events[0].toStatus).toBe('CREATED')
    expect(events[0].actor).toBe('USER')
  })

  it('allows an unverified user to create a transfer (KYC gates processing, not creation)', async () => {
    // Product change: unverified users can draft a CREATED transfer
    // and then progress to the verification wizard. KYC is enforced
    // downstream at generatePayIdForTransfer (the point where we
    // start collecting AUD), not at creation.
    const pendingUser = await createTestUser({ kycStatus: 'PENDING' })
    const pendingRecipient = await createTestRecipient(pendingUser.id)

    const transfer = await createTransfer({
      userId: pendingUser.id,
      recipientId: pendingRecipient.id,
      corridorId,
      sendAmount: new Decimal(100),
      exchangeRate: new Decimal('1042.65'),
      fee: new Decimal(5),
    })
    expect(transfer.status).toBe('CREATED')
    expect(transfer.userId).toBe(pendingUser.id)
  })

  it('throws InvalidCorridorError for non-existent corridor', async () => {
    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId,
        corridorId: 'non-existent-corridor',
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal('1042.65'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(InvalidCorridorError)
  })

  it('throws InvalidCorridorError for inactive corridor', async () => {
    const inactive = await prisma.corridor.create({
      data: {
        baseCurrency: 'AUD',
        targetCurrency: 'GHS',
        active: false,
        minAmount: 10,
        maxAmount: 5000,
      },
    })

    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId,
        corridorId: inactive.id,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal('10.5'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(InvalidCorridorError)

    await prisma.corridor.delete({ where: { id: inactive.id } })
  })

  it('throws AmountOutOfRangeError when below corridor minimum', async () => {
    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId,
        corridorId,
        sendAmount: new Decimal(1), // min is 10
        exchangeRate: new Decimal('1042.65'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(AmountOutOfRangeError)
  })

  it('throws AmountOutOfRangeError when above corridor maximum', async () => {
    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId,
        corridorId,
        sendAmount: new Decimal(60000), // max is 50000
        exchangeRate: new Decimal('1042.65'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(AmountOutOfRangeError)
  })

  it('throws DailyLimitExceededError when cumulative sends exceed limit', async () => {
    // User has 10000 daily limit. Create a transfer for 9000 first.
    await createTransfer({
      userId: verifiedUserId,
      recipientId,
      corridorId,
      sendAmount: new Decimal(9000),
      exchangeRate: new Decimal('1042.65'),
      fee: new Decimal(5),
    })

    // Now try another 2000 — total 11000, exceeds 10000 limit
    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId,
        corridorId,
        sendAmount: new Decimal(2000),
        exchangeRate: new Decimal('1042.65'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(DailyLimitExceededError)
  })

  it('throws RecipientNotOwnedError when recipient belongs to another user', async () => {
    const otherUser = await createTestUser()
    const otherRecipient = await createTestRecipient(otherUser.id)

    await expect(
      createTransfer({
        userId: verifiedUserId,
        recipientId: otherRecipient.id,
        corridorId,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal('1042.65'),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(RecipientNotOwnedError)
  })
})
