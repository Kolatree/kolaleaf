import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMonoovaWebhook } from '../webhook'

// Mock dependencies
vi.mock('../../../db/client', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transfer: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../../../../generated/prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string
    constructor(message: string, opts: { code: string }) {
      super(message)
      this.code = opts.code
    }
  }
  return {
    Prisma: {
      PrismaClientKnownRequestError,
    },
  }
})

vi.mock('../payid-service', () => ({
  handlePaymentReceived: vi.fn(),
}))

vi.mock('../verify-signature', () => ({
  verifyMonoovaSignature: vi.fn(),
}))

import { prisma } from '../../../db/client'
import { Prisma } from '../../../../generated/prisma/client'
import { handlePaymentReceived } from '../payid-service'
import { verifyMonoovaSignature } from '../verify-signature'

const WEBHOOK_SECRET = 'test-webhook-secret'

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-001',
    eventType: 'payment.received',
    payIdReference: 'KL-txn-001-1700000000',
    amount: 250.0,
    timestamp: '2025-01-15T10:30:00Z',
    ...overrides,
  }
}

describe('handleMonoovaWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MONOOVA_WEBHOOK_SECRET', WEBHOOK_SECRET)
  })

  it('processes a valid webhook end-to-end', async () => {
    const rawBody = JSON.stringify(makePayload())
    const signature = 'any-signature'

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)

    // Atomic claim succeeds (no existing row)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    // Transfer found
    const transfer = { id: 'txn-001', payidReference: 'KL-txn-001-1700000000' }
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue(transfer as any)

    vi.mocked(handlePaymentReceived).mockResolvedValue({ id: 'txn-001', status: 'AUD_RECEIVED' } as any)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    await handleMonoovaWebhook(rawBody, signature)

    // Signature verified against the raw body (not JSON.stringify of a re-parsed object)
    expect(verifyMonoovaSignature).toHaveBeenCalledWith(rawBody, signature, WEBHOOK_SECRET)

    // Claim-row insert
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'monoova',
        eventId: 'evt-001',
        eventType: 'payment.received',
        processed: false,
      }),
    })

    // Transfer lookup
    expect(prisma.transfer.findFirst).toHaveBeenCalledWith({
      where: { payidReference: 'KL-txn-001-1700000000' },
    })

    // Payment processed
    expect(handlePaymentReceived).toHaveBeenCalledWith('txn-001', expect.any(Object))

    // Marked processed on success
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'monoova', eventId: 'evt-001' } },
      data: expect.objectContaining({ processed: true }),
    })

    // No delete on success path
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('skips duplicate webhook via P2002 (idempotency)', async () => {
    const rawBody = JSON.stringify(makePayload())
    const signature = 'any-signature'

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)

    // Unique-constraint violation on the claim insert
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002' } as any)
    )

    await handleMonoovaWebhook(rawBody, signature)

    // No processing, no update, no delete
    expect(prisma.transfer.findFirst).not.toHaveBeenCalled()
    expect(handlePaymentReceived).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('rejects invalid signature', async () => {
    const rawBody = JSON.stringify(makePayload())
    vi.mocked(verifyMonoovaSignature).mockReturnValue(false)

    await expect(
      handleMonoovaWebhook(rawBody, 'deadbeef')
    ).rejects.toThrow('Invalid webhook signature')

    expect(prisma.webhookEvent.create).not.toHaveBeenCalled()
    expect(handlePaymentReceived).not.toHaveBeenCalled()
  })

  it('marks processed but does not throw for unknown transfer reference', async () => {
    const rawBody = JSON.stringify(makePayload({ payIdReference: 'KL-unknown-ref' }))

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    await handleMonoovaWebhook(rawBody, 'sig')

    // Payment not processed (no transfer found)
    expect(handlePaymentReceived).not.toHaveBeenCalled()

    // Audit row marked processed so we don't retry it
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'monoova', eventId: 'evt-001' } },
      data: expect.objectContaining({ processed: true }),
    })
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('releases the claim (deletes) when processing throws', async () => {
    const rawBody = JSON.stringify(makePayload({ amount: 999.99 }))

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue({
      id: 'txn-001',
      payidReference: 'KL-txn-001-1700000000',
    } as any)

    vi.mocked(handlePaymentReceived).mockRejectedValue(
      new Error('Amount mismatch: expected 250.00, received 999.99')
    )
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as any)

    await expect(
      handleMonoovaWebhook(rawBody, 'sig')
    ).rejects.toThrow('Amount mismatch')

    // Claim released so provider retry can re-enter
    expect(prisma.webhookEvent.delete).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'monoova', eventId: 'evt-001' } },
    })
    // No processed=true update on failure
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
  })
})
