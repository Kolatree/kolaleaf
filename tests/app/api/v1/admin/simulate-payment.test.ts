import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'

vi.mock('@/lib/auth/admin-middleware', () => ({
  requireAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/middleware', () => ({
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))
vi.mock('@/lib/db/client', () => ({
  prisma: {
    transfer: {
      findUnique: vi.fn(),
    },
  },
}))
vi.mock('@/lib/payments/monoova/payid-service', () => ({
  handlePaymentReceived: vi.fn(),
}))
vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/admin/transfers/[id]/simulate-payment/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { handlePaymentReceived } from '@/lib/payments/monoova/payid-service'
import { logAuthEvent } from '@/lib/auth/audit'

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockFindUnique = vi.mocked(prisma.transfer.findUnique)
const mockHandlePayment = vi.mocked(handlePaymentReceived)
const mockLogAuthEvent = vi.mocked(logAuthEvent)

function req(body?: unknown): Request {
  return new Request(
    'http://localhost/api/v1/admin/transfers/t1/simulate-payment',
    {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
  )
}

describe('POST /api/v1/admin/transfers/[id]/simulate-payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    // Default all tests to stub mode — the route now refuses to run
    // without it (even outside production). Tests that want to assert
    // the flag-off behavior explicitly `delete` or override below.
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.KOLA_USE_STUB_PROVIDERS
  })

  it('returns 404 in production when stub flag is off', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.KOLA_USE_STUB_PROVIDERS
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
    expect(mockRequireAdmin).not.toHaveBeenCalled()
  })

  it('returns 403 in non-prod when stub flag is off (prevents real-provider simulation)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.KOLA_USE_STUB_PROVIDERS
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('stub_mode_required')
    expect(mockRequireAdmin).not.toHaveBeenCalled()
  })

  it('allows access in production when stub flag is on', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockFindUnique.mockResolvedValueOnce({ sendAmount: new Decimal('250') } as never)
    mockHandlePayment.mockResolvedValueOnce({ id: 't1', status: 'COMPLETED' } as never)

    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  it('returns 403 when caller is not an admin', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(403, 'Admin required'))
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    expect(mockHandlePayment).not.toHaveBeenCalled()
  })

  it('defaults the amount to the transfer sendAmount when body omits it', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockFindUnique.mockResolvedValueOnce({ sendAmount: new Decimal('1234.50') } as never)
    mockHandlePayment.mockResolvedValueOnce({ id: 't1', status: 'AUD_RECEIVED' } as never)

    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })

    expect(res.status).toBe(200)
    const [callTransferId, callAmount] = mockHandlePayment.mock.calls[0]
    expect(callTransferId).toBe('t1')
    expect(callAmount.toFixed(2)).toBe('1234.50')
  })

  it('honors an explicit amount override', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockFindUnique.mockResolvedValueOnce({ sendAmount: new Decimal('250.00') } as never)
    mockHandlePayment.mockResolvedValueOnce({ id: 't1', status: 'AUD_RECEIVED' } as never)

    const res = await POST(
      req({ amount: '1000.00' }),
      { params: Promise.resolve({ id: 't1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockHandlePayment.mock.calls[0][1].toFixed(2)).toBe('1000.00')
  })

  it('returns 404 when transfer does not exist', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
    expect(mockHandlePayment).not.toHaveBeenCalled()
  })

  it('returns 400 on amount mismatch from handlePaymentReceived', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockFindUnique.mockResolvedValueOnce({ sendAmount: new Decimal('250') } as never)
    mockHandlePayment.mockRejectedValueOnce(
      new Error('Amount mismatch: expected 250.00, received 249.00'),
    )
    const res = await POST(
      req({ amount: '249.00' }),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('writes ADMIN_SIMULATE_PAYMENT audit log on success', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin_007' } as never)
    mockFindUnique.mockResolvedValueOnce({ sendAmount: new Decimal('500') } as never)
    mockHandlePayment.mockResolvedValueOnce({ id: 't1', status: 'COMPLETED' } as never)

    await POST(req(), { params: Promise.resolve({ id: 't1' }) })

    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin_007',
        event: 'ADMIN_SIMULATE_PAYMENT',
      }),
    )
  })
})
