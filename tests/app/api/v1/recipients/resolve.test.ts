import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>(
    '@/lib/auth/middleware',
  )
  return {
    ...actual,
    requireAuth: vi.fn(),
  }
})

vi.mock('@/lib/payments/payout/flutterwave', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/payout/flutterwave')>(
    '@/lib/payments/payout/flutterwave',
  )
  return {
    ...actual,
    createFlutterwaveProvider: vi.fn(),
  }
})

import { POST } from '@/app/api/v1/recipients/resolve/route'
import { requireAuth } from '@/lib/auth/middleware'
import { createFlutterwaveProvider } from '@/lib/payments/payout/flutterwave'
import { AccountNotFoundError } from '@/lib/payments/payout/types'
import { ProviderTemporaryError } from '@/lib/http/retry'

const mockRequireAuth = vi.mocked(requireAuth)
const mockCreateProvider = vi.mocked(createFlutterwaveProvider)

function makeRequest(body: unknown, opts: { userId?: string } = {}): Request {
  return new Request('http://localhost/api/v1/recipients/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `kolaleaf_session=${opts.userId ?? 'x'}`,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/recipients/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/recipients/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('malformed_json')
  })

  it('returns 422 when bankCode is missing (Zod)', async () => {
    const res = await POST(makeRequest({ accountNumber: '0690000031' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.bankCode).toBeInstanceOf(Array)
  })

  it('returns 422 when accountNumber is not 10 digits (Zod)', async () => {
    const r9 = await POST(makeRequest({ bankCode: '058', accountNumber: '123456789' }))
    expect(r9.status).toBe(422)

    const r11 = await POST(makeRequest({ bankCode: '058', accountNumber: '12345678901' }))
    expect(r11.status).toBe(422)

    const rNon = await POST(makeRequest({ bankCode: '058', accountNumber: 'abcdefghij' }))
    expect(rNon.status).toBe(422)
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))

    const res = await POST(makeRequest({ bankCode: '058', accountNumber: '0690000031' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 with accountName on successful resolve', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u-resolve-success',
      session: { id: 's1', userId: 'u-resolve-success' } as never,
    })
    const resolveMock = vi.fn().mockResolvedValue({ accountName: 'CHINWE OBIMMA' })
    mockCreateProvider.mockReturnValueOnce({ resolveAccount: resolveMock } as never)

    const res = await POST(makeRequest({ bankCode: '058', accountNumber: '0690000031' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.accountName).toBe('CHINWE OBIMMA')
    expect(resolveMock).toHaveBeenCalledWith({
      bankCode: '058',
      accountNumber: '0690000031',
    })
  })

  it('returns 404 when provider raises AccountNotFoundError', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u-nf',
      session: { id: 's1', userId: 'u-nf' } as never,
    })
    mockCreateProvider.mockReturnValueOnce({
      resolveAccount: vi.fn().mockRejectedValue(new AccountNotFoundError('FLUTTERWAVE')),
    } as never)

    const res = await POST(makeRequest({ bankCode: '058', accountNumber: '0000000000' }))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('account_not_found')
  })

  it('returns 503 on provider temporary error', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u-temp',
      session: { id: 's1', userId: 'u-temp' } as never,
    })
    mockCreateProvider.mockReturnValueOnce({
      resolveAccount: vi.fn().mockRejectedValue(new ProviderTemporaryError('network')),
    } as never)

    const res = await POST(makeRequest({ bankCode: '058', accountNumber: '0690000031' }))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('resolve_unavailable')
  })

  it('returns 429 when per-user rate limit is exceeded', async () => {
    // 21 calls from the same user; first 20 succeed, the 21st should be
    // rate-limited. Distinct userId keeps this test isolated from the others.
    mockRequireAuth.mockResolvedValue({
      userId: 'u-rate-limit',
      session: { id: 's1', userId: 'u-rate-limit' } as never,
    })
    mockCreateProvider.mockReturnValue({
      resolveAccount: vi.fn().mockResolvedValue({ accountName: 'OK' }),
    } as never)

    for (let i = 0; i < 20; i++) {
      const ok = await POST(makeRequest({ bankCode: '058', accountNumber: '0690000031' }))
      expect(ok.status).toBe(200)
    }
    const limited = await POST(makeRequest({ bankCode: '058', accountNumber: '0690000031' }))
    expect(limited.status).toBe(429)
    const json = await limited.json()
    expect(json.error).toBe('rate_limited')
  })
})
