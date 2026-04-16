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

import { GET } from '@/app/api/banks/route'
import { requireAuth } from '@/lib/auth/middleware'
import { createFlutterwaveProvider } from '@/lib/payments/payout/flutterwave'

const mockRequireAuth = vi.mocked(requireAuth)
const mockCreateProvider = vi.mocked(createFlutterwaveProvider)

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/banks${qs}`, {
    headers: { cookie: 'kolaleaf_session=x' },
  })
}

describe('GET /api/banks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))

    const res = await GET(makeRequest('?country=NG'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when country is missing', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })

    const res = await GET(makeRequest(''))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('unsupported_country')
  })

  it('returns 400 for an unsupported country (multi-corridor boundary)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })

    const res = await GET(makeRequest('?country=KE'))
    expect(res.status).toBe(400)
  })

  it('returns 200 with the banks array and private cache header', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const banks = [
      { name: 'Access Bank', code: '044' },
      { name: 'GTBank', code: '058' },
    ]
    mockCreateProvider.mockReturnValueOnce({
      listBanks: vi.fn().mockResolvedValue(banks),
    } as never)

    const res = await GET(makeRequest('?country=NG'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
    const json = await res.json()
    expect(json.banks).toEqual(banks)
  })

  it('returns 503 when the bank provider fails', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    mockCreateProvider.mockReturnValueOnce({
      listBanks: vi.fn().mockRejectedValue(new Error('network down')),
    } as never)

    const res = await GET(makeRequest('?country=NG'))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('banks_unavailable')
  })
})
