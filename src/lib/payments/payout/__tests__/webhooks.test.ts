import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db/client'
import Decimal from 'decimal.js'
import {
  handleFlutterwaveWebhook,
  handleBudPayWebhook,
} from '../webhooks'

// Mock the orchestrator module so webhooks route to it without real provider calls
vi.mock('../orchestrator', () => {
  return {
    getOrchestrator: () => ({
      handlePayoutSuccess: vi.fn(async (id: string) => {
        // Simulate the orchestrator transitions for tracking
        return { id, status: 'COMPLETED' }
      }),
      handlePayoutFailure: vi.fn(async (id: string, reason: string) => {
        return { id, status: 'NGN_FAILED', failureReason: reason }
      }),
    }),
  }
})

// ─── Test data helpers ────────────────────────────────

const FW_WEBHOOK_SECRET = 'fw-webhook-secret-hash'
const BP_WEBHOOK_SECRET = 'bp-webhook-secret'

function makeFlutterwavePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'transfer.completed',
    data: {
      id: 99001,
      reference: 'KL-PO-txn_fw_001-1700000000000',
      status: 'SUCCESSFUL',
      ...overrides,
    },
  }
}

function makeBudPayPayload(overrides: Record<string, unknown> = {}) {
  return {
    notify: 'transfer',
    data: {
      reference: 'KL-PO-txn_bp_001-1700000000000',
      status: 'success',
      amount: '500000.00',
      currency: 'NGN',
      fee: '50.00',
      ...overrides,
    },
  }
}

function budpaySignature(rawBody: string, secret: string): string {
  return crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex')
}

// ─── Setup / Teardown ────────────────────────────────

let userId: string
let recipientId: string
let corridorId: string

async function createTestTransfer(overrides: Record<string, unknown> = {}) {
  return prisma.transfer.create({
    data: {
      userId,
      recipientId,
      corridorId,
      sendAmount: new Decimal('1000.00'),
      receiveAmount: new Decimal('500000.00'),
      exchangeRate: new Decimal('500.00'),
      fee: new Decimal('5.00'),
      status: 'PROCESSING_NGN',
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FW-ref-001',
      ...overrides,
    },
  })
}

beforeEach(async () => {
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'WebhookTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'WebhookTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'WebhookTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'WebhookTest' } } })

  const user = await prisma.user.create({ data: { fullName: 'WebhookTest User' } })
  userId = user.id

  const recipient = await prisma.recipient.create({
    data: {
      userId,
      fullName: 'WebhookTest Recipient',
      bankName: 'Test Bank',
      bankCode: '044',
      accountNumber: '0690000031',
    },
  })
  recipientId = recipient.id

  const existing = await prisma.corridor.findUnique({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
  })
  if (existing) {
    corridorId = existing.id
  } else {
    const corridor = await prisma.corridor.create({
      data: {
        baseCurrency: 'AUD',
        targetCurrency: 'NGN',
        minAmount: new Decimal('10.00'),
        maxAmount: new Decimal('50000.00'),
      },
    })
    corridorId = corridor.id
  }
})

afterAll(async () => {
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'WebhookTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'WebhookTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'WebhookTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'WebhookTest' } } })
})

// ─── Tests ───────────────────────────────────────────

describe('Flutterwave webhook handler', () => {
  it('processes a successful transfer webhook', async () => {
    await createTestTransfer({
      payoutProviderRef: '99001',
    })

    const rawBody = JSON.stringify(makeFlutterwavePayload())
    await handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET)

    // Verify webhook event was stored for idempotency
    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'FLUTTERWAVE', eventId: '99001' },
    })
    expect(event).not.toBeNull()
    expect(event!.processed).toBe(true)
  })

  it('skips duplicate webhook events (idempotency)', async () => {
    await createTestTransfer({ payoutProviderRef: '99001' })

    const rawBody = JSON.stringify(makeFlutterwavePayload())

    // Process first time
    await handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET)
    // Process second time — should be skipped via P2002 on create
    await handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET)

    // Should only have one webhook event record
    const count = await prisma.webhookEvent.count({
      where: { provider: 'FLUTTERWAVE', eventId: '99001' },
    })
    expect(count).toBe(1)
  })

  it('rejects invalid signature', async () => {
    const rawBody = JSON.stringify(makeFlutterwavePayload())

    await expect(
      handleFlutterwaveWebhook(rawBody, 'wrong-secret', FW_WEBHOOK_SECRET),
    ).rejects.toThrow('Invalid Flutterwave webhook signature')
  })

  it('handles unknown transfer reference gracefully', async () => {
    const rawBody = JSON.stringify(makeFlutterwavePayload({ id: 99999 }))

    // Should not throw — just store the event
    await handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET)

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'FLUTTERWAVE', eventId: '99999' },
    })
    expect(event).not.toBeNull()
  })

  it('routes failed transfer to handlePayoutFailure', async () => {
    await createTestTransfer({ payoutProviderRef: '99002' })

    const rawBody = JSON.stringify(makeFlutterwavePayload({
      id: 99002,
      status: 'FAILED',
      complete_message: 'Account not found',
    }))

    await handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET)

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'FLUTTERWAVE', eventId: '99002' },
    })
    expect(event).not.toBeNull()
    expect(event!.processed).toBe(true)
  })

  it('rejects webhook with missing data.id (dedup poisoning defense)', async () => {
    const rawBody = JSON.stringify({ event: 'transfer.completed', data: { status: 'SUCCESSFUL' } })
    await expect(
      handleFlutterwaveWebhook(rawBody, FW_WEBHOOK_SECRET, FW_WEBHOOK_SECRET),
    ).rejects.toThrow(/missing data\.id/)
  })
})

describe('BudPay webhook handler', () => {
  it('processes a successful transfer webhook', async () => {
    await createTestTransfer({
      payoutProvider: 'BUDPAY',
      payoutProviderRef: 'KL-PO-txn_bp_001-1700000000000',
    })

    const rawBody = JSON.stringify(makeBudPayPayload())
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)

    await handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET)

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'BUDPAY', eventId: 'KL-PO-txn_bp_001-1700000000000' },
    })
    expect(event).not.toBeNull()
    expect(event!.processed).toBe(true)
  })

  it('skips duplicate webhook events (idempotency)', async () => {
    await createTestTransfer({
      payoutProvider: 'BUDPAY',
      payoutProviderRef: 'KL-PO-txn_bp_001-1700000000000',
    })

    const rawBody = JSON.stringify(makeBudPayPayload())
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)

    await handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET)
    await handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET)

    const count = await prisma.webhookEvent.count({
      where: { provider: 'BUDPAY', eventId: 'KL-PO-txn_bp_001-1700000000000' },
    })
    expect(count).toBe(1)
  })

  it('rejects invalid HMAC signature', async () => {
    const rawBody = JSON.stringify(makeBudPayPayload())

    await expect(
      handleBudPayWebhook(rawBody, 'invalid-signature', BP_WEBHOOK_SECRET),
    ).rejects.toThrow('Invalid BudPay webhook signature')
  })

  it('handles unknown transfer reference gracefully', async () => {
    const rawBody = JSON.stringify(makeBudPayPayload({
      reference: 'KL-PO-unknown-1700000000000',
    }))
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)

    await handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET)

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'BUDPAY', eventId: 'KL-PO-unknown-1700000000000' },
    })
    expect(event).not.toBeNull()
  })

  it('routes failed transfer to handlePayoutFailure', async () => {
    await createTestTransfer({
      payoutProvider: 'BUDPAY',
      payoutProviderRef: 'KL-PO-txn_bp_fail-1700000000000',
    })

    const rawBody = JSON.stringify(makeBudPayPayload({
      reference: 'KL-PO-txn_bp_fail-1700000000000',
      status: 'failed',
      reason: 'Could not credit account',
    }))
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)

    await handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET)

    const event = await prisma.webhookEvent.findFirst({
      where: { provider: 'BUDPAY', eventId: 'KL-PO-txn_bp_fail-1700000000000' },
    })
    expect(event).not.toBeNull()
    expect(event!.processed).toBe(true)
  })

  it('rejects webhook with missing data.reference (dedup poisoning defense)', async () => {
    const rawBody = JSON.stringify({ notify: 'transfer', data: { status: 'success' } })
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)
    await expect(
      handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET),
    ).rejects.toThrow(/missing or empty data\.reference/)
  })

  it('rejects webhook with empty-string data.reference (dedup poisoning defense)', async () => {
    const rawBody = JSON.stringify(makeBudPayPayload({ reference: '' }))
    const signature = budpaySignature(rawBody, BP_WEBHOOK_SECRET)
    await expect(
      handleBudPayWebhook(rawBody, signature, BP_WEBHOOK_SECRET),
    ).rejects.toThrow(/missing or empty data\.reference/)
  })
})
