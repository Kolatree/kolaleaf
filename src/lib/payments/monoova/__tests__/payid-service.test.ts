import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { generatePayIdForTransfer, handlePaymentReceived } from '../payid-service'
import type { MonoovaClient } from '../client'

// Mock the db client module
vi.mock('../../../db/client', () => ({
  prisma: {
    transfer: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    user: {
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

// Mock the payout orchestrator so handlePaymentReceived's post-transition
// kickoff doesn't touch real providers (or real prisma for the transfer
// lookup orchestrator.initiatePayout performs).
const orchestratorMocks = {
  initiatePayout: vi.fn(),
  handlePayoutSuccess: vi.fn(),
  handlePayoutFailure: vi.fn(),
}
vi.mock('../../payout/orchestrator', () => ({
  getOrchestrator: () => orchestratorMocks,
}))

const floatMonitorMocks = {
  checkFloatBalance: vi.fn(),
}
vi.mock('../../payout/float-monitor', () => ({
  FloatMonitor: class {
    checkFloatBalance = floatMonitorMocks.checkFloatBalance
  },
}))
vi.mock('../../payout/flutterwave', () => ({
  FlutterwaveProvider: class {
    constructor(_config: unknown) {}
  },
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
    vi.mocked(prisma.transfer.findUnique).mockReset()
    vi.mocked(prisma.transfer.updateMany).mockReset()
    vi.mocked(prisma.transfer.findUniqueOrThrow).mockReset()
    vi.mocked(prisma.user.findUniqueOrThrow).mockReset()
    vi.mocked(prisma.transferEvent.create).mockReset()
    vi.mocked(transitionTransfer).mockReset()
    orchestratorMocks.initiatePayout.mockReset()
    orchestratorMocks.handlePayoutSuccess.mockReset()
    orchestratorMocks.handlePayoutFailure.mockReset()
    floatMonitorMocks.checkFloatBalance.mockReset()
    // Default happy-path behavior for orchestrator — override per test.
    orchestratorMocks.initiatePayout.mockResolvedValue({ id: 'txn-001', status: 'PROCESSING_NGN' })
    orchestratorMocks.handlePayoutSuccess.mockResolvedValue({ id: 'txn-001', status: 'COMPLETED' })
    floatMonitorMocks.checkFloatBalance.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      balance: new Decimal('1000000'),
      sufficient: true,
    })
  })

  describe('generatePayIdForTransfer', () => {
    it('generates PayID for a CREATED transfer and transitions to AWAITING_AUD', async () => {
      const transfer = makeTransfer()
      const mockClient = makeMockClient()

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ kycStatus: 'VERIFIED' } as any)
      vi.mocked(prisma.transfer.updateMany).mockResolvedValue({ count: 1 } as any)

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
      expect(prisma.transfer.updateMany).toHaveBeenCalledWith({
        where: { id: 'txn-001', status: 'CREATED' },
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
          expectedStatus: 'CREATED',
        })
      )

      expect(result.status).toBe('AWAITING_AUD')
    })

    it('rejects if transfer is not in CREATED state', async () => {
      const transfer = makeTransfer({ status: 'AWAITING_AUD' })
      const mockClient = makeMockClient()

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ kycStatus: 'VERIFIED' } as any)

      await expect(
        generatePayIdForTransfer('txn-001', mockClient)
      ).rejects.toThrow('Transfer txn-001 is not in CREATED state')
    })

    it('rejects if transfer does not exist', async () => {
      const mockClient = makeMockClient()

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(null)

      await expect(
        generatePayIdForTransfer('txn-missing', mockClient)
      ).rejects.toThrow('Transfer txn-missing not found')
    })

    it('rejects with KycNotVerifiedError if the owning user is not VERIFIED', async () => {
      // Step 32 product change: transfer creation is open to
      // unverified users, but PayID issuance (= AUD collection) is
      // the AUSTRAC boundary and requires VERIFIED KYC.
      const transfer = makeTransfer()
      const mockClient = makeMockClient()

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ kycStatus: 'PENDING' } as any)

      await expect(
        generatePayIdForTransfer('txn-001', mockClient)
      ).rejects.toThrow(/KYC is not verified/)
      // Monoova must NOT have been called — we fail before any
      // external side effect.
      expect(mockClient.createPayId).not.toHaveBeenCalled()
    })

    it('bypasses the KYC gate when KOLA_DISABLE_KYC_GATE=true (dev/test only)', async () => {
      // Escape hatch for transaction-flow testing before Sumsub keys
      // land. With the flag ON, PENDING users should still get a
      // PayID so the CREATED → AWAITING_AUD transition can be
      // exercised. Flag defaults off in production.
      const prev = process.env.KOLA_DISABLE_KYC_GATE
      process.env.KOLA_DISABLE_KYC_GATE = 'true'
      try {
        const transfer = makeTransfer()
        const mockClient = makeMockClient()

        vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
        vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ kycStatus: 'PENDING' } as any)
        vi.mocked(prisma.transfer.updateMany).mockResolvedValue({ count: 1 } as any)
        vi.mocked(transitionTransfer).mockResolvedValue({
          ...transfer,
          status: 'AWAITING_AUD',
        } as any)

        const result = await generatePayIdForTransfer('txn-001', mockClient)

        expect(mockClient.createPayId).toHaveBeenCalled()
        expect(result.status).toBe('AWAITING_AUD')
      } finally {
        if (prev === undefined) delete process.env.KOLA_DISABLE_KYC_GATE
        else process.env.KOLA_DISABLE_KYC_GATE = prev
      }
    })

    it('propagates Monoova client errors', async () => {
      const transfer = makeTransfer()
      const mockClient = makeMockClient({
        createPayId: vi.fn().mockRejectedValue(new Error('Monoova API error: 500')),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ kycStatus: 'VERIFIED' } as any)

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

    it('kicks off payout orchestration after the AUD_RECEIVED transition', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AUD_RECEIVED',
      } as any)

      await handlePaymentReceived('txn-001', new Decimal('250.00'))

      // Mock history persists across tests in this file; the critical
      // assertion is that the orchestrator kickoff runs with the right
      // transferId — not the total call count.
      expect(transitionTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ transferId: 'txn-001', toStatus: 'AUD_RECEIVED' }),
      )
      expect(orchestratorMocks.initiatePayout).toHaveBeenCalledWith('txn-001')
    })

    it('parks the transfer in FLOAT_INSUFFICIENT when preflight float is low', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer)
        .mockResolvedValueOnce({ ...transfer, status: 'AUD_RECEIVED' } as any)
        .mockResolvedValueOnce({ ...transfer, status: 'FLOAT_INSUFFICIENT' } as any)
      floatMonitorMocks.checkFloatBalance.mockResolvedValueOnce({
        provider: 'FLUTTERWAVE',
        balance: new Decimal('1000'),
        sufficient: false,
      })

      const result = await handlePaymentReceived('txn-001', new Decimal('250.00'))

      expect(result.status).toBe('FLOAT_INSUFFICIENT')
      expect(transitionTransfer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          transferId: 'txn-001',
          toStatus: 'FLOAT_INSUFFICIENT',
          expectedStatus: 'AUD_RECEIVED',
        }),
      )
      expect(orchestratorMocks.initiatePayout).not.toHaveBeenCalled()
    })

    it('cascades to COMPLETED in stub mode via handlePayoutSuccess', async () => {
      const prev = process.env.KOLA_USE_STUB_PROVIDERS
      process.env.KOLA_USE_STUB_PROVIDERS = 'true'
      try {
        const transfer = makeTransfer({
          status: 'AWAITING_AUD',
          sendAmount: new Decimal('250.00'),
        })

        vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
        vi.mocked(transitionTransfer).mockResolvedValue({
          ...transfer,
          status: 'AUD_RECEIVED',
        } as any)

        const result = await handlePaymentReceived('txn-001', new Decimal('250.00'))

        expect(orchestratorMocks.initiatePayout).toHaveBeenCalledWith('txn-001')
        expect(orchestratorMocks.handlePayoutSuccess).toHaveBeenCalledWith('txn-001')
        expect(result.status).toBe('COMPLETED')
      } finally {
        if (prev === undefined) delete process.env.KOLA_USE_STUB_PROVIDERS
        else process.env.KOLA_USE_STUB_PROVIDERS = prev
      }
    })

    it('does NOT cascade when stub flag is off (real webhook-driven path)', async () => {
      delete process.env.KOLA_USE_STUB_PROVIDERS
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      vi.mocked(transitionTransfer).mockResolvedValue({
        ...transfer,
        status: 'AUD_RECEIVED',
      } as any)

      await handlePaymentReceived('txn-001', new Decimal('250.00'))

      expect(orchestratorMocks.initiatePayout).toHaveBeenCalledWith('txn-001')
      expect(orchestratorMocks.handlePayoutSuccess).not.toHaveBeenCalled()
    })

    it('swallows orchestrator.initiatePayout errors — webhook worker must ack', async () => {
      const transfer = makeTransfer({
        status: 'AWAITING_AUD',
        sendAmount: new Decimal('250.00'),
      })

      vi.mocked(prisma.transfer.findUnique).mockResolvedValue(transfer as any)
      const audReceived = { ...transfer, status: 'AUD_RECEIVED' }
      vi.mocked(transitionTransfer).mockResolvedValue(audReceived as any)
      orchestratorMocks.initiatePayout.mockRejectedValueOnce(
        new Error('BudPay down'),
      )

      // Must NOT throw — the outer webhook worker has to ack.
      const result = await handlePaymentReceived('txn-001', new Decimal('250.00'))
      expect(result.status).toBe('AUD_RECEIVED')
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
