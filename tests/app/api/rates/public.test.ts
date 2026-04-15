import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFindCorridor, mockFindRate } = vi.hoisted(() => ({
  mockFindCorridor: vi.fn(),
  mockFindRate: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    corridor: { findFirst: mockFindCorridor },
    rate: { findFirst: mockFindRate },
  },
}))

import { GET } from '@/app/api/rates/public/route'

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/rates/public${qs}`)
}

describe('GET /api/rates/public', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when base is missing', async () => {
    const res = await GET(makeRequest('?target=NGN'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('returns 400 when target is missing', async () => {
    const res = await GET(makeRequest('?base=AUD'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when corridor does not exist', async () => {
    mockFindCorridor.mockResolvedValue(null)
    const res = await GET(makeRequest('?base=AUD&target=XXX'))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('corridor_not_found')
  })

  it('returns 404 when corridor exists but is inactive', async () => {
    // The route filters by active: true, so inactive corridors are treated as not found
    mockFindCorridor.mockResolvedValue(null)
    const res = await GET(makeRequest('?base=AUD&target=NGN'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when no rate exists for an active corridor', async () => {
    mockFindCorridor.mockResolvedValue({
      id: 'cor_123',
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
    })
    mockFindRate.mockResolvedValue(null)

    const res = await GET(makeRequest('?base=AUD&target=NGN'))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('corridor_not_found')
  })

  it('returns 200 with the documented public shape for a valid pair', async () => {
    mockFindCorridor.mockResolvedValue({
      id: 'cor_123',
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
    })
    mockFindRate.mockResolvedValue({
      id: 'rate_1',
      corridorId: 'cor_123',
      customerRate: { toString: () => '1042.500000' },
      effectiveAt: new Date('2026-04-14T00:00:00.000Z'),
      // Fields that MUST NOT be exposed:
      wholesaleRate: { toString: () => '1050.000000' },
      spread: { toString: () => '0.007000' },
      adminOverride: true,
      setById: 'admin_1',
      provider: 'seed',
    })

    const res = await GET(makeRequest('?base=AUD&target=NGN'))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json).toEqual({
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      corridorId: 'cor_123',
      customerRate: '1042.500000',
      effectiveAt: '2026-04-14T00:00:00.000Z',
    })

    // No internal/admin fields leak
    expect(json.wholesaleRate).toBeUndefined()
    expect(json.spread).toBeUndefined()
    expect(json.adminOverride).toBeUndefined()
    expect(json.setById).toBeUndefined()
    expect(json.provider).toBeUndefined()
  })

  it('sets Cache-Control: public, max-age=60, stale-while-revalidate=120', async () => {
    mockFindCorridor.mockResolvedValue({
      id: 'cor_123',
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
    })
    mockFindRate.mockResolvedValue({
      id: 'rate_1',
      corridorId: 'cor_123',
      customerRate: { toString: () => '1042.500000' },
      effectiveAt: new Date('2026-04-14T00:00:00.000Z'),
    })

    const res = await GET(makeRequest('?base=AUD&target=NGN'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=60, stale-while-revalidate=120',
    )
  })

  it('honors admin-override rates (most-recent wins via RateService)', async () => {
    // Step 15b regression: the old route bypassed RateService and called
    // prisma.rate.findFirst directly. After the refactor, the route goes
    // through getCurrentRateByPair → RateService.getCurrentRate. This test
    // confirms that a rate flagged adminOverride is returned untouched as
    // long as it's the most recent (which is exactly what the route should
    // surface — admin overrides are simply the newest row).
    mockFindCorridor.mockResolvedValue({
      id: 'cor_123',
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
    })
    mockFindRate.mockResolvedValue({
      id: 'rate_admin',
      corridorId: 'cor_123',
      customerRate: { toString: () => '1100.000000' },
      effectiveAt: new Date('2026-04-15T10:00:00.000Z'),
      wholesaleRate: { toString: () => '1050.000000' },
      spread: { toString: () => '-0.047619' }, // implied negative spread (premium)
      adminOverride: true,
      setById: 'admin_user_1',
      provider: null,
    })

    const res = await GET(makeRequest('?base=AUD&target=NGN'))
    expect(res.status).toBe(200)

    const json = await res.json()
    // The admin-set customerRate is what the user sees.
    expect(json.customerRate).toBe('1100.000000')
    // Admin metadata still must not leak.
    expect(json.adminOverride).toBeUndefined()
    expect(json.setById).toBeUndefined()
  })

  it('normalizes base and target to uppercase', async () => {
    mockFindCorridor.mockResolvedValue({
      id: 'cor_123',
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
    })
    mockFindRate.mockResolvedValue({
      id: 'rate_1',
      corridorId: 'cor_123',
      customerRate: { toString: () => '1042.500000' },
      effectiveAt: new Date('2026-04-14T00:00:00.000Z'),
    })

    const res = await GET(makeRequest('?base=aud&target=ngn'))
    expect(res.status).toBe(200)
    expect(mockFindCorridor).toHaveBeenCalledWith({
      where: { baseCurrency: 'AUD', targetCurrency: 'NGN', active: true },
    })
  })
})
