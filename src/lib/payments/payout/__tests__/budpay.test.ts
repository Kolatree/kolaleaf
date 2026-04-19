import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { BudPayProvider, validateBudPayConfig } from '../budpay'
import { PayoutError } from '../types'

const mockFetch = vi.fn()
global.fetch = mockFetch

const provider = new BudPayProvider({
  secretKey: 'sk_test_budpay_abc123',
  apiUrl: 'https://api.budpay.com',
})

const validParams = {
  transferId: 'txn_bp_001',
  amount: new Decimal('250000.50'),
  currency: 'NGN',
  bankCode: '058',
  accountNumber: '0123456789',
  recipientName: 'Jane Doe',
  reference: 'KL-PO-txn_bp_001-1700000000000',
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('BudPayProvider', () => {
  it('has the correct name', () => {
    expect(provider.name).toBe('BUDPAY')
  })

  describe('initiatePayout', () => {
    it('POSTs /api/v2/bank_transfer with Bearer auth and idempotency key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          message: 'Transfer started',
          data: {
            reference: 'KL-PO-txn_bp_001-1700000000000',
            currency: 'NGN',
            amount: '250000.50',
            fee: '50.00',
            status: 'pending',
          },
        }),
      })

      const result = await provider.initiatePayout(validParams)

      expect(result.providerRef).toBe('KL-PO-txn_bp_001-1700000000000')
      expect(result.status).toBe('pending')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.budpay.com/api/v2/bank_transfer')
      expect(opts.method).toBe('POST')
      expect(opts.headers['Authorization']).toBe('Bearer sk_test_budpay_abc123')
      expect(opts.headers['Idempotency-Key']).toBe(validParams.reference)
      expect(opts.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(opts.body)
      // BudPay uses NGN (major units) — no kobo multiplication
      expect(body.amount).toBe('250000.50')
      expect(body.currency).toBe('NGN')
      expect(body.bank_code).toBe('058')
      expect(body.account_number).toBe('0123456789')
      expect(body.reference).toBe(validParams.reference)
      expect(body.narration).toContain('Jane Doe')
    })

    it('throws non-retryable PayoutError on 4xx', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: false,
          message: 'Invalid account number',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(PayoutError)
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('retries on 5xx and surfaces PayoutError after exhaustion', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ status: false, message: 'Server error' }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(PayoutError)
      // withRetry default: 3 attempts
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('getPayoutStatus', () => {
    it('returns status for a successful payout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: { status: 'success' },
        }),
      })

      const result = await provider.getPayoutStatus('KL-PO-txn_bp_001-1700000000000')

      expect(result.status).toBe('success')
      expect(result.failureReason).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.budpay.com/api/v2/verify-payout/KL-PO-txn_bp_001-1700000000000',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('returns failure reason when payout failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: { status: 'failed', reason: 'Account could not be credited' },
        }),
      })

      const result = await provider.getPayoutStatus('KL-PO-txn_bp_001-1700000000000')

      expect(result.status).toBe('failed')
      expect(result.failureReason).toBe('Account could not be credited')
    })

    it('retries then throws PayoutError on persistent 500', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ status: false, message: 'Server error' }),
      })

      await expect(provider.getPayoutStatus('KL-PO-xyz')).rejects.toThrow(PayoutError)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })
})

describe('BudPayProvider stub mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.KOLA_USE_STUB_PROVIDERS
    mockFetch.mockReset()
  })

  it('initiatePayout returns a STUB-BP- ref when secret key is missing (dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const stub = new BudPayProvider({ secretKey: '', apiUrl: 'https://api.budpay.com' })

    const result = await stub.initiatePayout(validParams)

    expect(result.providerRef).toBe('STUB-BP-' + validParams.reference)
    expect(result.status).toBe('success')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('initiatePayout uses the stub path when KOLA_USE_STUB_PROVIDERS=true even with a secret key', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    const stub = new BudPayProvider({
      secretKey: 'real-key',
      apiUrl: 'https://api.budpay.com',
    })

    const result = await stub.initiatePayout(validParams)

    expect(result.providerRef).toBe('STUB-BP-' + validParams.reference)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when KOLA_USE_STUB_PROVIDERS=true in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    const stub = new BudPayProvider({
      secretKey: 'real-key',
      apiUrl: 'https://api.budpay.com',
    })

    await expect(stub.initiatePayout(validParams)).rejects.toThrow(/forbidden in production/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when secret key is missing in production (defense-in-depth)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const stub = new BudPayProvider({ secretKey: '', apiUrl: 'https://api.budpay.com' })

    await expect(stub.initiatePayout(validParams)).rejects.toThrow(/production/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('getPayoutStatus returns success in stub mode', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const stub = new BudPayProvider({ secretKey: '', apiUrl: 'https://api.budpay.com' })

    const result = await stub.getPayoutStatus('STUB-BP-abc')

    expect(result.status).toBe('success')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('regression: real fetch path still fires when creds present + flag off', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.KOLA_USE_STUB_PROVIDERS
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: true,
        data: { reference: validParams.reference, status: 'pending' },
      }),
    })
    const real = new BudPayProvider({
      secretKey: 'real-key',
      apiUrl: 'https://api.budpay.com',
    })

    await real.initiatePayout(validParams)

    expect(mockFetch).toHaveBeenCalledOnce()
  })
})

describe('validateBudPayConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.BUDPAY_SECRET_KEY
    delete process.env.BUDPAY_API_URL
  })

  it('throws in production when BUDPAY_SECRET_KEY is missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.BUDPAY_SECRET_KEY

    expect(() => validateBudPayConfig()).toThrow(/BudPay config missing/)
  })

  it('returns isMock=true in dev when secret key is missing', () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.BUDPAY_SECRET_KEY

    const cfg = validateBudPayConfig()
    expect(cfg.isMock).toBe(true)
    expect(cfg.apiUrl).toBe('https://api.budpay.com')
  })

  it('returns isMock=false when secret key is present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.BUDPAY_SECRET_KEY = 'sk_live_abc'

    const cfg = validateBudPayConfig()
    expect(cfg.isMock).toBe(false)
    expect(cfg.secretKey).toBe('sk_live_abc')
  })
})
