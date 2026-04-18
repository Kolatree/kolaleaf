import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    authEvent: { findMany: vi.fn() },
    complianceReport: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/obs/logger', () => ({ log: vi.fn() }))

import {
  recordSecurityAnomalyCheck,
  __test,
  AUTH_HISTORY_LOOKBACK_DAYS,
  HISTORY_EVENT_LIMIT,
} from '@/lib/security/anomaly'
import { prisma } from '@/lib/db/client'

const mockAuthFindMany = vi.mocked(prisma.authEvent.findMany)
const mockCreate = vi.mocked(prisma.complianceReport.create)
const mockReportsFindMany = vi.mocked(prisma.complianceReport.findMany)
const mockUserFindUnique = vi.mocked(prisma.user.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthFindMany.mockResolvedValue([])
  mockCreate.mockResolvedValue({} as never)
  mockReportsFindMany.mockResolvedValue([] as never)
  mockUserFindUnique.mockResolvedValue(null as never)
})

describe('classifyBehavioural (pure)', () => {
  it('returns null when history is empty', () => {
    const result = __test.classifyBehavioural(
      { country: 'AU', deviceFingerprintHash: 'abc' },
      { countries: new Set(), devices: new Set() },
    )
    expect(result).toBeNull()
  })

  it('returns null when context matches baselines', () => {
    const result = __test.classifyBehavioural(
      { country: 'AU', deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBeNull()
  })

  it('flags new_country when country diverges', () => {
    const result = __test.classifyBehavioural(
      { country: 'RU', deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBe('new_country')
  })

  it('flags new_device when fingerprint diverges', () => {
    const result = __test.classifyBehavioural(
      { country: 'AU', deviceFingerprintHash: 'new' },
      { countries: new Set(['AU']), devices: new Set(['old']) },
    )
    expect(result).toBe('new_device')
  })

  it('flags new_country_and_device when both diverge', () => {
    const result = __test.classifyBehavioural(
      { country: 'RU', deviceFingerprintHash: 'new' },
      { countries: new Set(['AU']), devices: new Set(['old']) },
    )
    expect(result).toBe('new_country_and_device')
  })

  it('does not flag when current country is undefined (Railway degraded)', () => {
    const result = __test.classifyBehavioural(
      { deviceFingerprintHash: 'abc' },
      { countries: new Set(['AU']), devices: new Set(['abc']) },
    )
    expect(result).toBeNull()
  })

  it('does not flag when current fingerprint is undefined against rich history', () => {
    // Explicitly documents the policy decision: missing fingerprint
    // in the CURRENT request does not flag. "Degrades to known."
    const result = __test.classifyBehavioural(
      { country: 'AU' },
      { countries: new Set(['AU']), devices: new Set(['old']) },
    )
    expect(result).toBeNull()
  })

  it('does not flag Railway→CF migration path (seen has no country)', () => {
    // Baseline from Railway deploy has fingerprints but no country
    // (cf-ipcountry was never trusted). Now CF front takes over
    // and every request has a country. That first country arrives
    // should NOT be flagged as new_country — the country dimension
    // was never part of the baseline.
    const result = __test.classifyBehavioural(
      { country: 'AU', deviceFingerprintHash: 'd1' },
      { countries: new Set(), devices: new Set(['d1']) },
    )
    expect(result).toBeNull()
  })
})

describe('collectSeen (pure)', () => {
  it('collects country + fingerprint from metadata', () => {
    const seen = __test.collectSeen([
      { metadata: { country: 'AU', deviceFingerprintHash: 'd1' } },
      { metadata: { country: 'NZ', deviceFingerprintHash: 'd2' } },
    ])
    expect(seen.countries).toEqual(new Set(['AU', 'NZ']))
    expect(seen.devices).toEqual(new Set(['d1', 'd2']))
  })

  it('tolerates null metadata and legacy rows', () => {
    const seen = __test.collectSeen([
      { metadata: null },
      { metadata: { identifier: 'x@y.com' } },
      { metadata: { country: 'AU', deviceFingerprintHash: 'd1' } },
    ])
    expect(seen.countries).toEqual(new Set(['AU']))
    expect(seen.devices).toEqual(new Set(['d1']))
  })
})

describe('recordSecurityAnomalyCheck: self-inclusion P0 fix', () => {
  it('filters history by observedAt so the just-written AuthEvent row is excluded', async () => {
    const observedAt = new Date('2026-04-18T09:00:00Z')
    mockAuthFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'RU', deviceFingerprintHash: 'new' },
      event: 'LOGIN',
      observedAt,
    })
    expect(mockAuthFindMany).toHaveBeenCalledOnce()
    const args = mockAuthFindMany.mock.calls[0][0] as {
      where: { createdAt: { gte: Date; lt: Date } }
    }
    expect(args.where.createdAt.lt).toEqual(observedAt)
    // findMany returned rows, current diverges → SUSPICIOUS emitted
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('defaults observedAt to now when omitted (transfer path)', async () => {
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU' },
      event: 'TRANSFER_CREATE',
    })
    const args = mockAuthFindMany.mock.calls[0][0] as {
      where: { createdAt: { lt: Date } }
    }
    expect(args.where.createdAt.lt.getTime()).toBeGreaterThan(
      Date.now() - 5_000,
    )
  })
})

describe('recordSecurityAnomalyCheck: behavioural emission', () => {
  it('emits SUSPICIOUS on divergence with expected details shape', async () => {
    mockAuthFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: {
        ip: '203.0.113.5',
        ipTruncated: '203.0.113.0',
        country: 'RU',
        deviceFingerprintHash: 'new',
        userAgent: 'Chrome/x',
      },
      event: 'LOGIN',
    })
    expect(mockCreate).toHaveBeenCalledOnce()
    const data = mockCreate.mock.calls[0][0].data
    const details = data.details as {
      source: string
      kind: string
      ipTruncated: string
      userAgent?: string
    }
    expect(details.source).toBe('security_anomaly')
    expect(details.kind).toBe('new_country_and_device')
    expect(details.ipTruncated).toBe('203.0.113.0')
    // Raw userAgent MUST NOT be in compliance details per PII policy
    expect(details.userAgent).toBeUndefined()
  })

  it('does not emit on empty history', async () => {
    mockAuthFindMany.mockResolvedValue([])
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU', deviceFingerprintHash: 'd1' },
      event: 'LOGIN',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('recordSecurityAnomalyCheck: KYC-country mismatch', () => {
  it('emits kyc_country_mismatch when current.country differs from user.country', async () => {
    mockUserFindUnique.mockResolvedValue({ country: 'AU' } as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'RU', deviceFingerprintHash: 'd1' },
      event: 'TRANSFER_CREATE',
      transferId: 'tr_1',
    })
    const kinds = mockCreate.mock.calls.map(
      (c) => (c[0].data.details as { kind: string }).kind,
    )
    expect(kinds).toContain('kyc_country_mismatch')
  })

  it('does not emit kyc_country_mismatch when user has no KYC country yet', async () => {
    mockUserFindUnique.mockResolvedValue({ country: null } as never)
    mockAuthFindMany.mockResolvedValue([])
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU', deviceFingerprintHash: 'd1' },
      event: 'LOGIN',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not emit kyc_country_mismatch when current.country is undefined', async () => {
    mockUserFindUnique.mockResolvedValue({ country: 'AU' } as never)
    mockAuthFindMany.mockResolvedValue([])
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { deviceFingerprintHash: 'd1' },
      event: 'LOGIN',
    })
    const kinds = mockCreate.mock.calls.map(
      (c) => (c[0].data.details as { kind: string }).kind,
    )
    expect(kinds).not.toContain('kyc_country_mismatch')
  })
})

describe('recordSecurityAnomalyCheck: dedupe', () => {
  it('suppresses a second identical SUSPICIOUS within the dedupe window', async () => {
    mockAuthFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    // Pretend a matching report was already written earlier today.
    mockReportsFindMany.mockResolvedValue([
      {
        details: {
          source: 'security_anomaly',
          kind: 'new_country_and_device',
          country: 'RU',
          deviceFingerprintHash: 'new',
        },
      },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'RU', deviceFingerprintHash: 'new' },
      event: 'LOGIN',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('still emits when a different kind was previously recorded', async () => {
    mockAuthFindMany.mockResolvedValue([
      { metadata: { country: 'AU', deviceFingerprintHash: 'old' } },
    ] as never)
    mockReportsFindMany.mockResolvedValue([
      {
        details: {
          source: 'security_anomaly',
          kind: 'new_device',
          country: 'RU',
          deviceFingerprintHash: 'new',
        },
      },
    ] as never)
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'RU', deviceFingerprintHash: 'new' },
      event: 'LOGIN',
    })
    expect(mockCreate).toHaveBeenCalledOnce()
  })
})

describe('recordSecurityAnomalyCheck: contract guarantees', () => {
  it('never throws when ComplianceReport create fails', async () => {
    mockAuthFindMany.mockResolvedValue([
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

  it('never throws when findMany fails', async () => {
    mockAuthFindMany.mockRejectedValue(new Error('query failed'))
    await expect(
      recordSecurityAnomalyCheck({
        userId: 'u_1',
        context: { country: 'AU' },
        event: 'LOGIN',
      }),
    ).resolves.toBeUndefined()
  })

  it('respects AUTH_HISTORY_LOOKBACK_DAYS in the gte filter', async () => {
    const observedAt = new Date('2026-04-18T09:00:00Z')
    await recordSecurityAnomalyCheck({
      userId: 'u_1',
      context: { country: 'AU' },
      event: 'LOGIN',
      observedAt,
    })
    const args = mockAuthFindMany.mock.calls[0][0] as {
      where: { createdAt: { gte: Date } }
      take: number
    }
    const expected =
      observedAt.getTime() - AUTH_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    expect(args.where.createdAt.gte.getTime()).toBe(expected)
    expect(args.take).toBe(HISTORY_EVENT_LIMIT)
  })
})
