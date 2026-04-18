import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    authEvent: { findMany: vi.fn() },
    complianceReport: { create: vi.fn() },
  },
}))
vi.mock('@/lib/obs/logger', () => ({ log: vi.fn() }))

import { recordSecurityAnomalyCheck, __test } from '@/lib/security/anomaly'
import { prisma } from '@/lib/db/client'

const mockFindMany = vi.mocked(prisma.authEvent.findMany)
const mockCreate = vi.mocked(prisma.complianceReport.create)

beforeEach(() => {
  vi.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockCreate.mockResolvedValue({} as never)
})

describe('classify (pure)', () => {
  it('returns null when history is empty (no baseline)', () => {
    const result = __test.classify(
      { country: 'AU', deviceFingerprintHash: 'abc' },
      { countries: new Set(), devices: new Set() },
    )
    expect(result).toBeNull()
  })

  it('returns null when current context matches existing baselines', () => {
    const result = __test.classify(
      { country: 'AU', deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBeNull()
  })

  it('flags new_country when country diverges but device is known', () => {
    const result = __test.classify(
      { country: 'RU', deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBe('new_country')
  })

  it('flags new_device when fingerprint diverges but country is known', () => {
    const result = __test.classify(
      { country: 'AU', deviceFingerprintHash: 'new-hash' },
      { countries: new Set(['AU']), devices: new Set(['old-hash']) },
    )
    expect(result).toBe('new_device')
  })

  it('flags new_country_and_device when both diverge', () => {
    const result = __test.classify(
      { country: 'RU', deviceFingerprintHash: 'new' },
      { countries: new Set(['AU']), devices: new Set(['old']) },
    )
    expect(result).toBe('new_country_and_device')
  })

  it('does not flag when only one dimension is populated and still known', () => {
    // Degraded path: Railway edge doesn't set a country header. We
    // get undefined country on every request. Should NOT flag.
    const result = __test.classify(
      { deviceFingerprintHash: 'abc' },
      { countries: new Set(), devices: new Set(['abc']) },
    )
    expect(result).toBeNull()
  })

  it('does not flag on missing current country when history has some', () => {
    // We saw AU before, now we get an undefined country — absence is
    // not divergence; treat as known.
    const result = __test.classify(
      { deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBeNull()
  })
})

describe('collectSeen (pure)', () => {
  it('pulls country + fingerprint out of AuthEvent metadata', () => {
    const seen = __test.collectSeen([
      {
        metadata: { country: 'AU', deviceFingerprintHash: 'd1' },
      },
      {
        metadata: { country: 'NZ', deviceFingerprintHash: 'd2' },
      },
    ])
    expect(seen.countries).toEqual(new Set(['AU', 'NZ']))
    expect(seen.devices).toEqual(new Set(['d1', 'd2']))
  })

  it('tolerates null metadata and legacy rows without the fields', () => {
    const seen = __test.collectSeen([
      { metadata: null },
      { metadata: { identifier: 'x@y.com' } },
      { metadata: { country: 'AU', deviceFingerprintHash: 'd1' } },
    ])
    expect(seen.countries).toEqual(new Set(['AU']))
    expect(seen.devices).toEqual(new Set(['d1']))
  })
})

describe('recordSecurityAnomalyCheck (integration over mocked prisma)', () => {
  it('emits SUSPICIOUS ComplianceReport with source=security_anomaly on divergence', async () => {
    mockFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: {
        ip: '203.0.113.5',
        country: 'RU',
        deviceFingerprintHash: 'new',
        userAgent: 'Chrome/x',
      },
      event: 'LOGIN',
    })
    expect(mockCreate).toHaveBeenCalledOnce()
    const data = mockCreate.mock.calls[0][0].data
    expect(data.type).toBe('SUSPICIOUS')
    expect(data.userId).toBe('u_1')
    const details = data.details as {
      source: string
      kind: string
      country: string
      knownCountries: string[]
    }
    expect(details.source).toBe('security_anomaly')
    expect(details.kind).toBe('new_country_and_device')
    expect(details.knownCountries).toEqual(['AU'])
  })

  it('does not emit on first-ever event (empty history)', async () => {
    mockFindMany.mockResolvedValue([])
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU', deviceFingerprintHash: 'd1' },
      event: 'LOGIN',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not emit when current context matches prior fingerprints', async () => {
    mockFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'd1' } },
      { metadata: { country: 'AU', deviceFingerprintHash: 'd1' } },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU', deviceFingerprintHash: 'd1' },
      event: 'LOGIN',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('binds transferId into the report when supplied', async () => {
    mockFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU', deviceFingerprintHash: 'new' },
      event: 'TRANSFER_CREATE',
      transferId: 'tr_1',
    })
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockCreate.mock.calls[0][0].data.transferId).toBe('tr_1')
  })

  it('does not throw when ComplianceReport create fails (fire-and-forget contract)', async () => {
    mockFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    mockCreate.mockRejectedValue(new Error('DB offline'))
    await expect(
      recordSecurityAnomalyCheck({
        userId: 'u_1',
        context: { country: 'RU', deviceFingerprintHash: 'new' },
        event: 'LOGIN',
      }),
    ).resolves.toBeUndefined()
  })

  it('does not throw when findMany fails', async () => {
    mockFindMany.mockRejectedValue(new Error('query failed'))
    await expect(
      recordSecurityAnomalyCheck({
        userId: 'u_1',
        context: { country: 'AU' },
        event: 'LOGIN',
      }),
    ).resolves.toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
