import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetCurrentRate } = vi.hoisted(() => {
  const mockGetCurrentRate = vi.fn()
  return { mockGetCurrentRate }
})

vi.mock('@/lib/rates', () => ({
  RateService: class MockRateService {
    getCurrentRate = mockGetCurrentRate
  },
  DefaultFxRateProvider: class MockFxProvider {},
}))

import { GET } from '@/app/api/v1/rates/[corridorId]/route'

describe('GET /api/v1/rates/[corridorId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns rate data for valid corridor', async () => {
    const mockRate = {
      corridorId: 'aud-ngn',
      customerRate: { toString: () => '1042.50' },
      effectiveAt: new Date('2024-01-01T00:00:00Z'),
    }
    mockGetCurrentRate.mockResolvedValue(mockRate)

    const req = new Request('http://localhost/api/v1/rates/aud-ngn')
    const res = await GET(req, { params: Promise.resolve({ corridorId: 'aud-ngn' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.customerRate).toBe('1042.50')
    expect(json.corridorId).toBe('aud-ngn')
  })

  it('returns 404 when no rate exists', async () => {
    mockGetCurrentRate.mockResolvedValue(null)

    const req = new Request('http://localhost/api/v1/rates/nonexistent')
    const res = await GET(req, { params: Promise.resolve({ corridorId: 'nonexistent' }) })
    expect(res.status).toBe(404)
  })
})
