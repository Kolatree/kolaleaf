import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { TransferStatus } from '../../../src/generated/prisma/enums'
import { transitionTransfer } from '../../../src/lib/transfers/state-machine'
import {
  InvalidTransitionError,
  ConcurrentModificationError,
  TransferNotFoundError,
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

describe('transitionTransfer', () => {
  it('performs a valid transition (CREATED -> AWAITING_AUD)', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    const result = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
    })
    expect(result.status).toBe('AWAITING_AUD')
  })

  it('throws InvalidTransitionError for invalid transition', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await expect(
      transitionTransfer({
        transferId: transfer.id,
        toStatus: 'COMPLETED',
        actor: 'SYSTEM',
      })
    ).rejects.toThrow(InvalidTransitionError)
  })

  it('throws InvalidTransitionError for transitions out of terminal state', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'COMPLETED' })
    await expect(
      transitionTransfer({
        transferId: transfer.id,
        toStatus: 'PROCESSING_NGN',
        actor: 'SYSTEM',
      })
    ).rejects.toThrow(InvalidTransitionError)
  })

  it('throws TransferNotFoundError for non-existent transfer', async () => {
    await expect(
      transitionTransfer({
        transferId: 'non-existent-id',
        toStatus: 'AWAITING_AUD',
        actor: 'SYSTEM',
      })
    ).rejects.toThrow(TransferNotFoundError)
  })

  it('creates a TransferEvent with correct from/to/actor', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
      metadata: { reason: 'PayID generated' },
    })

    const events = await prisma.transferEvent.findMany({
      where: { transferId: transfer.id, fromStatus: 'CREATED', toStatus: 'AWAITING_AUD' },
    })
    expect(events.length).toBe(1)
    expect(events[0].actor).toBe('SYSTEM')
    expect(events[0].metadata).toEqual({ reason: 'PayID generated' })
  })

  it('stores actorId when provided', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'NEEDS_MANUAL' })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'ADMIN',
      actorId: 'admin-123',
    })

    const event = await prisma.transferEvent.findFirst({
      where: { transferId: transfer.id, fromStatus: 'NEEDS_MANUAL', toStatus: 'PROCESSING_NGN' },
    })
    expect(event!.actorId).toBe('admin-123')
  })

  describe('retry logic', () => {
    it('increments retryCount on NGN_RETRY -> PROCESSING_NGN', async () => {
      const transfer = await createTestTransfer(userId, recipientId, {
        status: 'NGN_RETRY',
        retryCount: 1,
      })
      const result = await transitionTransfer({
        transferId: transfer.id,
        toStatus: 'PROCESSING_NGN',
        actor: 'SYSTEM',
      })
      expect(result.retryCount).toBe(2)
    })

    it('forces NEEDS_MANUAL when retryCount >= 3 on NGN_RETRY', async () => {
      const transfer = await createTestTransfer(userId, recipientId, {
        status: 'NGN_RETRY',
        retryCount: 3,
      })
      // Attempting to go to PROCESSING_NGN should be overridden to NEEDS_MANUAL
      const result = await transitionTransfer({
        transferId: transfer.id,
        toStatus: 'PROCESSING_NGN',
        actor: 'SYSTEM',
      })
      expect(result.status).toBe('NEEDS_MANUAL')
    })
  })

  describe('optimistic locking', () => {
    it('detects concurrent modification', async () => {
      const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })

      // Simulate a race: transition the transfer out-of-band before the second call reads it
      // First transition succeeds
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: 'AWAITING_AUD',
        actor: 'SYSTEM',
      })

      // Second transition tries from CREATED (stale) — but status is now AWAITING_AUD
      // Since the DB status is AWAITING_AUD, transitioning to AWAITING_AUD is invalid from AWAITING_AUD
      await expect(
        transitionTransfer({
          transferId: transfer.id,
          toStatus: 'AWAITING_AUD',
          actor: 'SYSTEM',
          expectedStatus: 'CREATED',
        })
      ).rejects.toThrow(ConcurrentModificationError)
    })
  })

  describe('multi-step transitions', () => {
    it('walks the happy path CREATED -> AWAITING_AUD -> AUD_RECEIVED -> PROCESSING_NGN -> NGN_SENT -> COMPLETED', async () => {
      const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })

      const steps: TransferStatus[] = [
        'AWAITING_AUD',
        'AUD_RECEIVED',
        'PROCESSING_NGN',
        'NGN_SENT',
        'COMPLETED',
      ]

      let current = transfer
      for (const next of steps) {
        current = await transitionTransfer({
          transferId: transfer.id,
          toStatus: next,
          actor: 'SYSTEM',
        })
        expect(current.status).toBe(next)
      }

      // Verify all events were created (initial + 5 transitions = 6 total events)
      const events = await prisma.transferEvent.findMany({
        where: { transferId: transfer.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(events.length).toBe(6) // 1 initial + 5 transitions
    })
  })
})
