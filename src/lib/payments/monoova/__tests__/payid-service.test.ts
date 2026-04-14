import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { generatePayIdForTransfer, handlePaymentReceived } from '../payid-service'
import type { MonoovaClient } from '../client'

// Mock the db client module
vi.mock('../../../db/client', () => ({
  prisma: {
    $transaction: vi.fn(),
    transfer: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    transferEvent: {
      create: vi.fn(),
    },
  },
}))

// Mock the state machine
vi.mock('../../../transfers/state-machine', () => ({
  transitionTransfer: vi.fn(),
}))

import { prisma } from '../../../db/client'
import { transitionTransfer } from '../../../transfers/state-machine'

function makeTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-001',
    userId: 'user-001',
    recipientId: 'rcpt-001',
    corridorId: 'cor-001',
    sendAmount: new Decimal('250.00'),
    sendCurrency: 'AUD',
    receiveAmount: new Decimal('100000.00'),
    receiveCurrency: 'NGN',
    exchangeRate: new Decimal('400.000000'),
    fee: new Decimal('5.00'),
    status: 'CREATED',
    payidReference: null,
    payidProviderRef: null,
    payoutProvider: null,
    payoutProviderRef: null,
    failureReason: null,
    retryCount: 0,
    createdAt: new Date('2025-01-15T00:00:00Z'),
    updatedAt: new Date('2025-01-15T00:00:00Z'),
    completedAt: null,
    ...overrides,
  }
}

function makeMockClient(overrides: Partial<MonoovaClient> = {}): MonoovaClient {
  return {
    createPayId: vi.fn().mockResolvedValue({
      payId: 'kolaleaf@payid.monoova.com',
      payIdReference: 'KL-txn-001-1700000000',
    }),
    getPaymentStatus: vi.fn().mockResolvedValue({
      status: 'completed',
      amount: 250.0,
    }),
    ...overrides,
  }
}

describe('PayID Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('generatePayIdForTransfer', () => {
    it('generates PayID for a CREATED transfer and transitions to AWAITING_AUD', async () => {
      const transfer = makeTransfer()
      const mockClient = makeMockClient()

      // Mock $transaction to execute the callback with a mock tx
      const mockTx = {
        transfer: {
          findUnique: vi.fn().mockResolvedValue(transfer),
          update: vi.fn().mockResolvedValue({
            ...transfer,
            payidReference: expect.any(String),
            payidProviderRef: 'kolaleaf@payid.monoova.com',
          }),
        },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: Function) => cb(mockTx))

      // Mock transitionTransfer to return the updated transfer
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AWAITING_AUD',
        payidReference: 'KL-txn-001-1700000000',
        payidProviderRef: 'kolaleaf@payid.monoova.com',
      } as any)

      const result = await generatePayIdForTransfer('txn-001', mockClient)

      // Verify client was called
      expect(mockClient.createPayId).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 'txn-001',
          amount: expect.any(Decimal),
          reference: expect.stringMatching(/^KL-txn-001-/),
        })
      )

      // Verify transfer was updated with PayID refs
      expect(mockTx.transfer.update).toHaveBeenCalledWith({
        where: { id: 'txn-001' },
        data: expect.objectContaining({
          payidReference: expect.stringMatching(/^KL-txn-001-/),
          payidProviderRef: 'kolaleaf@payid.monoova.com',
        }),
      })

      // Verify state transition
      expect(transitionTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 'txn-001',
          toStatus: 'AWAITING_AUD',
          actor: 'SYSTEM',
        })
      )

      expect(result.status).toBe('AWAITING_AUD')
    })

    it('rejects if transfer is not in CREATED state', async () => {
      const transfer = makeTransfer({ status: 'AWAITING_AUD' })
      const mockClient = makeMockClient()

      const mockTx = {
        transfer: { findUnique: vi.fn().mockResolvedValue(transfer) },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: Function) => cb(mockTx))

      await expect(
        generatePayIdForTransfer('txn-001', mockClient)
      ).rejects.toThrow('Transfer txn-001 is not in CREATED state')
    })

    it('rejects if transfer does not exist', async () => {
      const mockClient = makeMockClient()

      const mockTx = {
        transfer: { findUnique: vi.fn().mockResolvedValue(null) },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: Function) => cb(mockTx))

      await expect(
        generatePayIdForTransfer('txn-missing', mockClient)
      ).rejects.toThrow('Transfer txn-missing not found')
    })

    it('propagates Monoova client errors', async () => {
      const transfer = makeTransfer()
      const mockClient = makeMockClient({
        createPayId: vi.fn().mockRejectedValue(new Error('Monoova API error: 500')),
      })

      const mockTx = {
        transfer: { findUnique: vi.fn().mockResolvedValue(transfer) },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: Function) => cb(mockTx))

      await expect(
        generatePayIdForTransfer('txn-001', mockClient)
      ).rejects.toThrow('Monoova API error: 500')
    })
  })

  describe('handlePaymentReceived', () => {
    it('transitions to AUD_RECEIVED when amount matches exactly', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        payidReference: 'KL-txn-001-1700000000',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AUD_RECEIVED',
      } as any)

      const result = await handlePaymentReceived('txn-001', new Decimal('250.00'))

      expect(transitionTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 'txn-001',
          toStatus: 'AUD_RECEIVED',
          actor: 'SYSTEM',
          expectedStatus: 'AWAITING_AUD',
        })
      )

      expect(result.status).toBe('AUD_RECEIVED')
    })

    it('accepts payment within $0.01 tolerance (underpay)', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      // Mock prisma to find the transfer for amount validation
      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AUD_RECEIVED',
      } as any)

      // $249.99 is within $0.01 tolerance
      const result = await handlePaymentReceived('txn-001', new Decimal('249.99'))
      expect(result.status).toBe('AUD_RECEIVED')
    })

    it('accepts payment within $0.01 tolerance (overpay)', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AUD_RECEIVED',
      } as any)

      // $250.01 is within $0.01 tolerance
      const result = await handlePaymentReceived('txn-001', new Decimal('250.01'))
      expect(result.status).toBe('AUD_RECEIVED')
    })

    it('rejects payment outside tolerance (underpay)', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)

      await expect(
        handlePaymentReceived('txn-001', new Decimal('249.00'))
      ).rejects.toThrow('Amount mismatch')
    })

    it('rejects payment outside tolerance (overpay)', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)

      await expect(
        handlePaymentReceived('txn-001', new Decimal('251.00'))
      ).rejects.toThrow('Amount mismatch')
    })

    it('rejects if transfer not found', async () => {
      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(null)

      await expect(
        handlePaymentReceived('txn-missing', new Decimal('100.00'))
      ).rejects.toThrow('Transfer txn-missing not found')
    })
  })
})
