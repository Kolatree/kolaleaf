import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  getTransfer,
  listTransfers,
  getTransferWithEvents,
} from '../../../src/lib/transfers/queries.js'
import { transitionTransfer } from '../../../src/lib/transfers/state-machine.js'
import {
  prisma,
  createTestUser,
  createTestRecipient,
  createTestTransfer,
  cleanupTestData,
} from './helpers.js'

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
  await prisma.$disconnect()
})

describe('getTransfer', () => {
  it('returns transfer if owned by user', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    const result = await getTransfer(transfer.id, userId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(transfer.id)
  })

  it('returns null for another user transfer', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    const result = await getTransfer(transfer.id, otherUserId)
    expect(result).toBeNull()
  })

  it('returns null for non-existent transfer', async () => {
    const result = await getTransfer('non-existent', userId)
    expect(result).toBeNull()
  })
})

describe('listTransfers', () => {
  it('returns paginated results with cursor', async () => {
    // Create 5 transfers
    for (let i = 0; i < 5; i++) {
      await createTestTransfer(userId, recipientId)
    }

    // Get first page (limit 2)
    const page1 = await listTransfers(userId, { limit: 2 })
    expect(page1.transfers.length).toBe(2)
    expect(page1.nextCursor).toBeDefined()

    // Get second page using cursor
    const page2 = await listTransfers(userId, { limit: 2, cursor: page1.nextCursor })
    expect(page2.transfers.length).toBe(2)
    expect(page2.nextCursor).toBeDefined()

    // No overlap between pages
    const page1Ids = page1.transfers.map((t) => t.id)
    const page2Ids = page2.transfers.map((t) => t.id)
    expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids))

    // Get third page — should have 1 result
    const page3 = await listTransfers(userId, { limit: 2, cursor: page2.nextCursor })
    expect(page3.transfers.length).toBe(1)
    expect(page3.nextCursor).toBeUndefined()
  })

  it('filters by status', async () => {
    await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await createTestTransfer(userId, recipientId, { status: 'CREATED' })
    await createTestTransfer(userId, recipientId, { status: 'COMPLETED' })

    const created = await listTransfers(userId, { status: 'CREATED' })
    expect(created.transfers.length).toBe(2)
    expect(created.transfers.every((t) => t.status === 'CREATED')).toBe(true)

    const completed = await listTransfers(userId, { status: 'COMPLETED' })
    expect(completed.transfers.length).toBe(1)
  })

  it('returns empty for user with no transfers', async () => {
    const result = await listTransfers(otherUserId)
    expect(result.transfers).toEqual([])
    expect(result.nextCursor).toBeUndefined()
  })
})

describe('getTransferWithEvents', () => {
  it('includes events in chronological order', async () => {
    const transfer = await createTestTransfer(userId, recipientId, { status: 'CREATED' })

    // Walk through a few transitions
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

    const result = await getTransferWithEvents(transfer.id)
    expect(result.id).toBe(transfer.id)
    expect(result.events.length).toBe(3) // initial + 2 transitions
    // Events should be in chronological order
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        result.events[i - 1].createdAt.getTime()
      )
    }
  })

  it('throws for non-existent transfer', async () => {
    await expect(getTransferWithEvents('non-existent')).rejects.toThrow()
  })
})
