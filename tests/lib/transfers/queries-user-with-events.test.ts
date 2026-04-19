import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { getUserTransferWithEvents } from '../../../src/lib/transfers/queries'
import { transitionTransfer } from '../../../src/lib/transfers/state-machine'
import {
  prisma,
  createTestUser,
  createTestRecipient,
  createTestTransfer,
  cleanupTestData,
} from './helpers'

let userId: string
let recipientId: string
let otherUserId: string

beforeAll(async () => {
  await cleanupTestData()
  const user = await createTestUser()
  userId = user.id
  const recipient = await createTestRecipient(userId)
  recipientId = recipient.id
  const otherUser = await createTestUser()
  otherUserId = otherUser.id
})

afterEach(async () => {
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
})

describe('getUserTransferWithEvents', () => {
  it('returns null for a transfer not owned by the user', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    const result = await getUserTransferWithEvents(transfer.id, otherUserId)
    expect(result).toBeNull()
  })

  it('returns null for a non-existent transfer', async () => {
    const result = await getUserTransferWithEvents('non-existent', userId)
    expect(result).toBeNull()
  })

  it('returns the transfer with events for the owner, in chronological order', async () => {
    const transfer = await createTestTransfer(userId, recipientId, {
      status: 'CREATED',
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AUD_RECEIVED',
      actor: 'SYSTEM',
    })

    const result = await getUserTransferWithEvents(transfer.id, userId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(transfer.id)
    expect(result!.events.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < result!.events.length; i++) {
      expect(result!.events[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        result!.events[i - 1].createdAt.getTime(),
      )
    }
  })

  it('omits internal admin-only fields while exposing PayID instructions and hiding event metadata', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        failureReason: 'should-not-leak',
        payoutProviderRef: 'pp-ref',
        payoutProvider: 'FLUTTERWAVE',
        payidProviderRef: 'payid-ref',
        payidReference: 'payid-ref-2',
        retryCount: 3,
      },
    })

    const result = await getUserTransferWithEvents(transfer.id, userId)
    expect(result).not.toBeNull()
    const view = result as unknown as Record<string, unknown>
    expect(view.failureReason).toBeUndefined()
    expect(view.payoutProviderRef).toBeUndefined()
    expect(view.payoutProvider).toBeUndefined()
    expect(view.retryCount).toBeUndefined()
    expect(result!.payidProviderRef).toBe('payid-ref')
    expect(result!.payidReference).toBe('payid-ref-2')

    // Events must not include metadata (may contain provider error text).
    for (const event of result!.events) {
      const raw = event as unknown as Record<string, unknown>
      expect(raw.metadata).toBeUndefined()
      expect(raw.actorId).toBeUndefined()
    }
  })

  it('returns the recipient projection without sensitive bank fields', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    const result = await getUserTransferWithEvents(transfer.id, userId)
    expect(result).not.toBeNull()
    expect(result!.recipient).toEqual({
      id: recipientId,
      fullName: expect.any(String),
      bankName: expect.any(String),
    })
    const recip = result!.recipient as unknown as Record<string, unknown>
    expect(recip.accountNumber).toBeUndefined()
    expect(recip.bankCode).toBeUndefined()
  })
})
