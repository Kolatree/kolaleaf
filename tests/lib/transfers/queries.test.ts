import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  getTransfer,
  listTransfers,
  getTransferWithEvents,
} from '../../../src/lib/transfers/queries'
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
  // Scoped cleanup: only wipe transfers/events between tests so the beforeAll
  // user/recipient/otherUser fixtures survive. cleanupTestData (in afterAll)
  // wipes the rest.
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

  it('omits internal fields from the user-safe projection', async () => {
    // Ensure leaks like provider refs, retry counts, and failure reasons are
    // never returned to user-facing routes (they ARE allowed in admin views,
    // but admin uses prisma directly, not getTransfer).
    const transfer = await createTestTransfer(userId, recipientId)
    // Populate internal fields so we can prove they get stripped.
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        failureReason: 'should-not-leak',
        payoutProviderRef: 'pp-ref-123',
        payoutProvider: 'FLUTTERWAVE',
        payidProviderRef: 'payid-ref-456',
        payidReference: 'payid-789',
        retryCount: 3,
      },
    })

    const result = await getTransfer(transfer.id, userId)
    expect(result).not.toBeNull()

    const view = result as unknown as Record<string, unknown>
    expect(view.failureReason).toBeUndefined()
    expect(view.payoutProviderRef).toBeUndefined()
    expect(view.payoutProvider).toBeUndefined()
    expect(view.payidProviderRef).toBeUndefined()
    expect(view.payidReference).toBeUndefined()
    expect(view.retryCount).toBeUndefined()

    // Sanity: the public fields ARE present.
    expect(result!.id).toBe(transfer.id)
    expect(result!.status).toBeDefined()
    expect(result!.sendAmount).toBeDefined()
  })

  it('includes recipient projection without sensitive bank fields', async () => {
    const transfer = await createTestTransfer(userId, recipientId)
    const result = await getTransfer(transfer.id, userId)
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

  it('includes recipient { id, fullName, bankName } and omits sensitive fields', async () => {
    // Create fresh fixtures inline — the suite's afterEach wipes between tests.
    const user = await createTestUser()
    const recipient = await createTestRecipient(user.id)
    await createTestTransfer(user.id, recipient.id)

    const result = await listTransfers(user.id)
    expect(result.transfers.length).toBe(1)

    const t = result.transfers[0]
    expect(t.recipient).toEqual({
      id: recipient.id,
      fullName: 'Test Recipient',
      bankName: 'GTBank',
    })
    const recipientFields = t.recipient as unknown as Record<string, unknown>
    expect(recipientFields.accountNumber).toBeUndefined()
    expect(recipientFields.bankCode).toBeUndefined()
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
