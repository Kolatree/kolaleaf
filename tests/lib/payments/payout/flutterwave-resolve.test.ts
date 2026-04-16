import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  FlutterwaveProvider,
  NG_BANKS_FALLBACK,
} from '@/lib/payments/payout/flutterwave'
import { AccountNotFoundError } from '@/lib/payments/payout/types'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('FlutterwaveProvider.listBanks', () => {
  it('returns the hardcoded fallback in dev mode (no secret key) without hitting the network', async () => {
    const dev = new FlutterwaveProvider({
      secretKey: '',
      apiUrl: 'https://api.flutterwave.com/v3',
    })

    const banks = await dev.listBanks('NG')
    expect(banks.length).toBe(NG_BANKS_FALLBACK.length)
    expect(banks[0]).toEqual({ name: 'Access Bank', code: '044' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches from /v3/banks/NG in production and normalises the response', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        data: [
          { id: 1, code: '044', name: 'Access Bank' },
          { id: 2, code: '058', name: 'GTBank' },
          { code: '', name: '' }, // should be filtered out
        ],
      }),
    })

    const banks = await prod.listBanks('NG')
    expect(banks).toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'GTBank', code: '058' },
    ])

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.flutterwave.com/v3/banks/NG')
    expect(opts.method).toBe('GET')
    expect(opts.headers['Authorization']).toBe('Bearer FLWSECK-live-xyz')
  })

  it('caches the result across calls within 24h', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        data: [{ code: '044', name: 'Access Bank' }],
      }),
    })

    await prod.listBanks('NG')
    await prod.listBanks('NG')

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('FlutterwaveProvider.resolveAccount', () => {
  it('returns deterministic DEMO ACCOUNT <last4> in dev mode', async () => {
    const dev = new FlutterwaveProvider({
      secretKey: '',
      apiUrl: 'https://api.flutterwave.com/v3',
    })

    const res = await dev.resolveAccount({
      bankCode: '058',
      accountNumber: '0690000031',
    })
    expect(res.accountName).toBe('DEMO ACCOUNT 0031')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts to /v3/accounts/resolve with a SHA-256 Idempotency-Key derived from bankCode+accountNumber', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { account_name: 'CHINWE OBIMMA', account_number: '0690000031' },
      }),
    })

    const { accountName } = await prod.resolveAccount({
      bankCode: '058',
      accountNumber: '0690000031',
    })
    expect(accountName).toBe('CHINWE OBIMMA')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.flutterwave.com/v3/accounts/resolve')
    expect(opts.method).toBe('POST')

    const expectedKey = createHash('sha256').update('058:0690000031').digest('hex')
    expect(opts.headers['Idempotency-Key']).toBe(expectedKey)

    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      account_number: '0690000031',
      account_bank: '058',
    })
  })

  it('preserves the provider-returned account name literally (no trim / case change)', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { account_name: '  Chinwe O. Obimma  ' },
      }),
    })

    const { accountName } = await prod.resolveAccount({
      bankCode: '058',
      accountNumber: '0690000031',
    })
    expect(accountName).toBe('  Chinwe O. Obimma  ')
  })

  it('throws AccountNotFoundError when the provider returns an error response', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        status: 'error',
        message: 'Could not resolve account',
      }),
    })

    await expect(
      prod.resolveAccount({ bankCode: '058', accountNumber: '0000000000' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)
  })

  it('throws AccountNotFoundError when the 200 response has no account_name', async () => {
    const prod = new FlutterwaveProvider({
      secretKey: 'FLWSECK-live-xyz',
      apiUrl: 'https://api.flutterwave.com/v3',
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: {} }),
    })

    await expect(
      prod.resolveAccount({ bankCode: '058', accountNumber: '0690000031' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError)
  })
})
