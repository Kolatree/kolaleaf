import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    twoFactorChallenge: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sms', () => ({
  sendSms: vi.fn().mockResolvedValue({ ok: true, id: 'SM_mock' }),
}))

import { prisma } from '@/lib/db/client'
import { sendSms } from '@/lib/sms'
import {
  issueSmsChallenge,
  verifyChallenge,
} from '@/lib/auth/two-factor-challenge'

const mockCreate = vi.mocked(prisma.twoFactorChallenge.create)
const mockFindUnique = vi.mocked(prisma.twoFactorChallenge.findUnique)
const mockUpdate = vi.mocked(prisma.twoFactorChallenge.update)
const mockSendSms = vi.mocked(sendSms)

describe('issueSmsChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a TwoFactorChallenge with SMS method and 5-min expiry, and sends SMS', async () => {
    const before = Date.now()
    mockCreate.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: 'hash',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    } as never)

    const result = await issueSmsChallenge('u1', '+61400000000')

    expect(result.challengeId).toBe('ch_1')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const args = mockCreate.mock.calls[0][0]
    expect(args.data.userId).toBe('u1')
    expect(args.data.method).toBe('SMS')
    const codeHash = args.data.codeHash
    expect(typeof codeHash).toBe('string')
    expect(typeof codeHash === 'string' && codeHash.length > 0).toBe(true)
    const expiresMs = new Date(args.data.expiresAt as Date).getTime()
    // within 5min ± a 2s fudge for execution time
    expect(expiresMs).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 2000)
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 2000)

    expect(mockSendSms).toHaveBeenCalledTimes(1)
    const smsArgs = mockSendSms.mock.calls[0][0]
    expect(smsArgs.to).toBe('+61400000000')
    expect(smsArgs.body).toMatch(/\d{6}/)
  })
})

describe('verifyChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true for matching code, marks consumedAt', async () => {
    // Build a real bcrypt hash so we can verify against it.
    const bcrypt = (await import('bcrypt')).default
    const code = '123456'
    const hash = await bcrypt.hash(code, 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    } as never)
    mockUpdate.mockResolvedValue({} as never)

    const ok = await verifyChallenge('ch_1', code)
    expect(ok).toBe(true)

    // First update increments attempts; second (or combined final) sets consumedAt.
    const updates = mockUpdate.mock.calls.map((c) => c[0])
    const consumedUpdate = updates.find(
      (u) => u.data && 'consumedAt' in u.data && u.data.consumedAt,
    )
    expect(consumedUpdate).toBeDefined()
  })

  it('returns false for wrong code and increments attempts', async () => {
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash('123456', 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    } as never)
    mockUpdate.mockResolvedValue({} as never)

    const ok = await verifyChallenge('ch_1', '000000')
    expect(ok).toBe(false)
    // attempts incremented
    const attemptsUpdate = mockUpdate.mock.calls.find(
      (c) => c[0].data && 'attempts' in c[0].data,
    )
    expect(attemptsUpdate).toBeDefined()
  })

  it('returns false for missing challenge', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const ok = await verifyChallenge('nope', '123456')
    expect(ok).toBe(false)
  })

  it('returns false for expired challenge', async () => {
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash('123456', 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    } as never)

    const ok = await verifyChallenge('ch_1', '123456')
    expect(ok).toBe(false)
  })

  it('returns false when attempts already >= 5', async () => {
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash('123456', 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 5,
      consumedAt: null,
      createdAt: new Date(),
    } as never)

    const ok = await verifyChallenge('ch_1', '123456')
    expect(ok).toBe(false)
  })

  it('returns false when already consumed (no reuse)', async () => {
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash('123456', 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 1,
      consumedAt: new Date(),
      createdAt: new Date(),
    } as never)

    const ok = await verifyChallenge('ch_1', '123456')
    expect(ok).toBe(false)
  })

  it('burns consumedAt on the 5th (exhausting) attempt — even a correct code on a later call then fails', async () => {
    // Pre-fix: attempts hit 5, consumedAt stayed null, so a race could
    // resurrect the challenge until expiry. Post-fix: the 5th update sets
    // consumedAt=now() in the SAME update as the final attempts increment.
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash('123456', 4)

    // 5th submission with a wrong code: attempts goes 4 -> 5, consumedAt burns.
    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 4,
      consumedAt: null,
      createdAt: new Date(),
    } as never)
    mockUpdate.mockResolvedValue({} as never)

    const firstResult = await verifyChallenge('ch_1', '000000')
    expect(firstResult).toBe(false)

    // Exactly one update: increment + consumedAt together.
    const exhaustingUpdates = mockUpdate.mock.calls.filter((c) => {
      const d = c[0].data as Record<string, unknown>
      return 'attempts' in d && 'consumedAt' in d && d.consumedAt
    })
    expect(exhaustingUpdates.length).toBeGreaterThanOrEqual(1)

    // Now simulate a 6th call with the CORRECT code. Because consumedAt is
    // stamped from the previous call, the challenge must refuse.
    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 5,
      consumedAt: new Date(),
      createdAt: new Date(),
    } as never)

    const followup = await verifyChallenge('ch_1', '123456')
    expect(followup).toBe(false)
  })

  it('a correct code on the exhausting attempt still returns true but does not double-stamp consumedAt', async () => {
    // Defensive: if the 5th submission happens to be correct, we should not
    // issue two updates setting consumedAt.
    const bcrypt = (await import('bcrypt')).default
    const code = '123456'
    const hash = await bcrypt.hash(code, 4)

    mockFindUnique.mockResolvedValueOnce({
      id: 'ch_1',
      userId: 'u1',
      method: 'SMS',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 4,
      consumedAt: null,
      createdAt: new Date(),
    } as never)
    mockUpdate.mockResolvedValue({} as never)

    const ok = await verifyChallenge('ch_1', code)
    expect(ok).toBe(true)

    // Only ONE update that sets consumedAt — the exhausting one.
    const consumedUpdates = mockUpdate.mock.calls.filter((c) => {
      const d = c[0].data as Record<string, unknown>
      return 'consumedAt' in d && d.consumedAt
    })
    expect(consumedUpdates).toHaveLength(1)
  })
})
