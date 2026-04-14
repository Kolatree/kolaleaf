import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { handleMonoovaWebhook } from '../webhook'

// Mock dependencies
vi.mock('../../../db/client', () => ({
  prisma: {
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    transfer: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../payid-service', () => ({
  handlePaymentReceived: vi.fn(),
}))

vi.mock('../verify-signature', () => ({
  verifyMonoovaSignature: vi.fn(),
}))

import { prisma } from '../../../db/client'
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

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
}

describe('handleMonoovaWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set env var for webhook secret
    vi.stubEnv('MONOOVA_WEBHOOK_SECRET', WEBHOOK_SECRET)
  })

  it('processes a valid webhook end-to-end', async () => {
    const payload = makePayload()
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)

    // No existing webhook event (not a duplicate)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)

    // Transfer found
    const transfer = { id: 'txn-001', payidReference: 'KL-txn-001-1700000000' }
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue(transfer as any)

    // handlePaymentReceived succeeds
    vi.mocked(handlePaymentReceived).mockResolvedValue({ id: 'txn-001', status: 'AUD_RECEIVED' } as any)

    // webhookEvent.create succeeds
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    await handleMonoovaWebhook(payload, signature)

    // Verify signature was checked
    expect(verifyMonoovaSignature).toHaveBeenCalledWith(payloadStr, signature, WEBHOOK_SECRET)

    // Verify idempotency check
    expect(prisma.webhookEvent.findUnique).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'monoova', eventId: 'evt-001' } },
    })

    // Verify transfer lookup
    expect(prisma.transfer.findFirst).toHaveBeenCalledWith({
      where: { payidReference: 'KL-txn-001-1700000000' },
    })

    // Verify payment was processed
    expect(handlePaymentReceived).toHaveBeenCalledWith('txn-001', expect.any(Object))

    // Verify webhook event was stored
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'monoova',
        eventId: 'evt-001',
        eventType: 'payment.received',
        processed: true,
      }),
    })
  })

  it('skips duplicate webhook (idempotency)', async () => {
    const payload = makePayload()
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)

    // Existing webhook event found — duplicate
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue({
      id: 'wh-existing',
      provider: 'monoova',
      eventId: 'evt-001',
      processed: true,
    } as any)

    await handleMonoovaWebhook(payload, signature)

    // Should NOT process payment or create new event
    expect(handlePaymentReceived).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled()
  })

  it('rejects invalid signature', async () => {
    const payload = makePayload()
    const badSignature = 'deadbeef'

    vi.mocked(verifyMonoovaSignature).mockReturnValue(false)

    await expect(
      handleMonoovaWebhook(payload, badSignature)
    ).rejects.toThrow('Invalid webhook signature')

    expect(prisma.webhookEvent.findUnique).not.toHaveBeenCalled()
    expect(handlePaymentReceived).not.toHaveBeenCalled()
  })

  it('logs but does not throw for unknown transfer reference', async () => {
    const payload = makePayload({ payIdReference: 'KL-unknown-ref' })
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue(null) // not found

    // webhookEvent still stored
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    // Should NOT throw
    await handleMonoovaWebhook(payload, signature)

    // Payment not processed (no transfer found)
    expect(handlePaymentReceived).not.toHaveBeenCalled()

    // But webhook event is still stored for audit
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'monoova',
        eventId: 'evt-001',
        processed: false,
      }),
    })
  })

  it('flags amount mismatch from handlePaymentReceived', async () => {
    const payload = makePayload({ amount: 999.99 })
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifyMonoovaSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.transfer.findFirst).mockResolvedValue({
      id: 'txn-001',
      payidReference: 'KL-txn-001-1700000000',
    } as any)

    // handlePaymentReceived throws amount mismatch
    vi.mocked(handlePaymentReceived).mockRejectedValue(
      new Error('Amount mismatch: expected 250.00, received 999.99')
    )

    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    // Should still store the event but re-throw the error
    await expect(
      handleMonoovaWebhook(payload, signature)
    ).rejects.toThrow('Amount mismatch')

    // Webhook event stored with processed=false on error
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'monoova',
        eventId: 'evt-001',
        processed: false,
      }),
    })
  })
})
