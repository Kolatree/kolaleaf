import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    emailVerificationToken: {
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    userIdentifier: {
      updateMany: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'evt' }),
  renderVerificationEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}))

import {
  issueVerificationCode,
  verifyEmailWithCode,
  VERIFICATION_CODE_MAX_ATTEMPTS,
} from '@/lib/auth/email-verification'
import { hashToken } from '@/lib/auth/tokens'
import { prisma } from '@/lib/db/client'
import { sendEmail } from '@/lib/email'

const mockSend = vi.mocked(sendEmail)
const mockCount = vi.mocked(prisma.emailVerificationToken.count)
const mockUpdateMany = vi.mocked(prisma.emailVerificationToken.updateMany)
const mockCreate = vi.mocked(prisma.emailVerificationToken.create)
const mockFindFirst = vi.mocked(prisma.emailVerificationToken.findFirst)
const mockUpdate = vi.mocked(prisma.emailVerificationToken.update)
const mockIdentUpdate = vi.mocked(prisma.userIdentifier.updateMany)
const mockAuthEvent = vi.mocked(prisma.authEvent.create)

describe('issueVerificationCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ ok: true, id: 'evt' })
  })

  it('returns rate_limited when 5+ tokens issued in last hour', async () => {
    mockCount.mockResolvedValueOnce(5)
    const result = await issueVerificationCode({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('rate_limited')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('invalidates outstanding tokens, creates new token with attempts=0, sends email', async () => {
    mockCount.mockResolvedValueOnce(0)
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockCreate.mockResolvedValueOnce({ id: 't1' } as never)

    const result = await issueVerificationCode({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test User',
    })

    expect(result.ok).toBe(true)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', email: 'a@b.com', usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        email: 'a@b.com',
        attempts: 0,
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('hashes the code so the raw never enters the DB', async () => {
    mockCount.mockResolvedValueOnce(0)
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    mockCreate.mockResolvedValueOnce({ id: 't1' } as never)

    await issueVerificationCode({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test',
    })

    const writtenHash = mockCreate.mock.calls[0][0].data.tokenHash as string
    // Hash is 64 hex chars (sha256). Raw codes are 6 digits.
    expect(writtenHash).toHaveLength(64)
    expect(writtenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(writtenHash).not.toMatch(/^\d{6}$/)
  })
})

describe('verifyEmailWithCode', () => {
  const futureDate = () => new Date(Date.now() + 30 * 60 * 1000)
  const pastDate = () => new Date(Date.now() - 1000)
  const baseToken = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    userId: 'u1',
    email: 'a@b.com',
    tokenHash: hashToken('123456'),
    expiresAt: futureDate(),
    usedAt: null,
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no_token when none exists for the email', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('no_token')
  })

  it('returns used when token already consumed', async () => {
    mockFindFirst.mockResolvedValueOnce(baseToken({ usedAt: new Date() }) as never)
    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('used')
  })

  it('returns expired when past expiry', async () => {
    mockFindFirst.mockResolvedValueOnce(baseToken({ expiresAt: pastDate() }) as never)
    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('expired')
  })

  it('returns too_many_attempts before checking the code', async () => {
    mockFindFirst.mockResolvedValueOnce(
      baseToken({ attempts: VERIFICATION_CODE_MAX_ATTEMPTS }) as never,
    )
    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_many_attempts')
  })

  it('returns wrong_code and increments attempts when code does not match', async () => {
    mockFindFirst.mockResolvedValueOnce(baseToken({ attempts: 0 }) as never)
    mockUpdate.mockResolvedValueOnce({ attempts: 1 } as never)

    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '999999' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('wrong_code')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { attempts: { increment: 1 } },
    })
  })

  it('burns the token on the Nth wrong attempt and returns too_many_attempts', async () => {
    mockFindFirst.mockResolvedValueOnce(
      baseToken({ attempts: VERIFICATION_CODE_MAX_ATTEMPTS - 1 }) as never,
    )
    // First update returns the post-increment count (now == MAX).
    mockUpdate
      .mockResolvedValueOnce({ attempts: VERIFICATION_CODE_MAX_ATTEMPTS } as never)
      .mockResolvedValueOnce({} as never)

    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '999999' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_many_attempts')
    // Token should be marked used so further guesses can't continue against it.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('marks token used, identifier verified, logs LOGIN/EMAIL_VERIFIED on success', async () => {
    mockFindFirst.mockResolvedValueOnce(baseToken() as never)
    mockUpdate.mockResolvedValueOnce({} as never)
    mockIdentUpdate.mockResolvedValueOnce({ count: 1 })
    mockAuthEvent.mockResolvedValueOnce({} as never)

    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.userId).toBe('u1')

    expect(mockIdentUpdate).toHaveBeenCalledWith({
      where: { userId: 'u1', type: 'EMAIL', identifier: 'a@b.com' },
      data: { verified: true, verifiedAt: expect.any(Date) },
    })
    expect(mockAuthEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        event: 'EMAIL_VERIFIED',
      }),
    })
  })

  it('returns no_token if identifier was deleted between issue and verify', async () => {
    mockFindFirst.mockResolvedValueOnce(baseToken() as never)
    mockUpdate.mockResolvedValueOnce({} as never)
    mockIdentUpdate.mockResolvedValueOnce({ count: 0 })

    const out = await verifyEmailWithCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('no_token')
    expect(mockAuthEvent).not.toHaveBeenCalled()
  })
})
