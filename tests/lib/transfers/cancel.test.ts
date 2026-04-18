import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { cancelTransfer } from '../../../src/lib/transfers/cancel'
import {
  InvalidTransitionError,
  NotTransferOwnerError,
  TransferNotFoundError,
  CancelTooLateError,
} from '../../../src/lib/transfers/errors'
import {
  prisma,
  createTestUser,
  createTestRecipient,
  createTestTransfer,
  cleanupTestData,
} from './helpers'

let userId: string
let recipientId: string

beforeAll(async () => {
  await cleanupTestData()
  const user = await createTestUser()
  userId = user.id
  const recipient = await createTestRecipient(userId)
  recipientId = recipient.id
})

afterEach(async () => {
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

describe('cancelTransfer', () => {
  it('cancels from CREATED state', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    const result = await cancelTransfer({ transferId: transfer.id, userId })
    expect(result.status).toBe('CANCELLED')
  })

  it('cancels from AWAITING_AUD state', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'AWAITING_AUD' })
    const result = await cancelTransfer({ transferId: transfer.id, userId })
    expect(result.status).toBe('CANCELLED')
  })

  it('creates a TransferEvent for cancellation', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await cancelTransfer({ transferId: transfer.id, userId })

    const events = await prisma.transferEvent.findMany({
      where: { transferId: transfer.id, toStatus: 'CANCELLED' },
    })
    expect(events.length).toBe(1)
    expect(events[0].fromStatus).toBe('CREATED')
    expect(events[0].actor).toBe('USER')
  })

  // Step 31 / audit gap #19: post-AUD cancellations now throw
  // CancelTooLateError (user-friendly) rather than the generic
  // InvalidTransitionError. Route handlers can surface a specific
  // 409 message about the cancel window having closed.

  it('throws CancelTooLateError when cancelling from AUD_RECEIVED', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'AUD_RECEIVED' })
    await expect(
      cancelTransfer({ transferId: transfer.id, userId })
    ).rejects.toThrow(CancelTooLateError)
  })

  it('throws CancelTooLateError when cancelling from PROCESSING_NGN', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'PROCESSING_NGN' })
    await expect(
      cancelTransfer({ transferId: transfer.id, userId })
    ).rejects.toThrow(CancelTooLateError)
  })

  it('throws CancelTooLateError when cancelling from COMPLETED', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'COMPLETED' })
    await expect(
      cancelTransfer({ transferId: transfer.id, userId })
    ).rejects.toThrow(CancelTooLateError)
  })

  it('still throws InvalidTransitionError for cancel from terminal CANCELLED (no legal path)', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CANCELLED' })
    await expect(
      cancelTransfer({ transferId: transfer.id, userId })
    ).rejects.toThrow(InvalidTransitionError)
  })

  it('throws NotTransferOwnerError when non-owner cancels', async () => {
    const otherUser = await createTestUser()
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await expect(
      cancelTransfer({ transferId: transfer.id, userId: otherUser.id })
    ).rejects.toThrow(NotTransferOwnerError)
  })

  it('throws TransferNotFoundError for non-existent transfer', async () => {
    await expect(
      cancelTransfer({ transferId: 'non-existent', userId })
    ).rejects.toThrow(TransferNotFoundError)
  })
})
