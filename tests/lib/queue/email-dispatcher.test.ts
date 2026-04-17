import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The handler calls into sendEmail; mock it so no real Resend round-trip.
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
  return {
    ...actual,
    sendEmail: vi.fn(),
  }
})

vi.mock('@/lib/db/client', () => ({
  prisma: {
    failedEmail: { create: vi.fn() },
  },
}))

import { sendEmail } from '@/lib/email'
import { prisma } from '@/lib/db/client'
import {
  InProcessEmailDispatcher,
  handleEmailJob,
  getEmailDispatcher,
  __resetEmailDispatcher,
  __jobIdForEmail,
  type EmailJob,
} from '@/lib/queue/email-dispatcher'

const mockSend = vi.mocked(sendEmail)
const mockFailedEmailCreate = vi.mocked(prisma.failedEmail.create)

const verificationJob: EmailJob = {
  template: 'verification_code',
  toEmail: 'alice@example.com',
  recipientName: 'Alice',
  code: '123456',
  expiresInMinutes: 30,
}

const resetJob: EmailJob = {
  template: 'password_reset',
  toEmail: 'alice@example.com',
  recipientName: 'Alice',
  resetUrl: 'https://app.example/reset?token=x',
  expiresInMinutes: 60,
}

describe('InProcessEmailDispatcher + handleEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetEmailDispatcher()
    delete process.env.REDIS_URL
  })
  afterEach(() => {
    __resetEmailDispatcher()
  })

  it('dispatches verification_code: renders template and calls sendEmail', async () => {
    mockSend.mockResolvedValue({ ok: true, id: 'resend-1' })
    const d = new InProcessEmailDispatcher()
    await d.dispatch(verificationJob)
    expect(mockSend).toHaveBeenCalledOnce()
    const args = mockSend.mock.calls[0][0]
    expect(args.to).toBe('alice@example.com')
    expect(args.text).toContain('123456')
  })

  it('dispatches password_reset: renders template and calls sendEmail', async () => {
    mockSend.mockResolvedValue({ ok: true })
    const d = new InProcessEmailDispatcher()
    await d.dispatch(resetJob)
    expect(mockSend).toHaveBeenCalledOnce()
    const args = mockSend.mock.calls[0][0]
    expect(args.text).toContain('https://app.example/reset?token=x')
  })

  it('rethrows on sendEmail failure so BullMQ retry kicks in', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'rate limited' })
    // attemptsMade=0, maxAttempts=8 — this is NOT the last attempt
    await expect(handleEmailJob(verificationJob, 0, 8)).rejects.toThrow('rate limited')
    // Intermediate retries must NOT write to FailedEmail
    expect(mockFailedEmailCreate).not.toHaveBeenCalled()
  })

  it('on last attempt failure: writes FailedEmail row then rethrows', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'quota exceeded' })
    mockFailedEmailCreate.mockResolvedValue({} as never)
    // attemptsMade=7 with maxAttempts=8 -> this IS the final attempt
    await expect(handleEmailJob(verificationJob, 7, 8)).rejects.toThrow('quota exceeded')
    expect(mockFailedEmailCreate).toHaveBeenCalledOnce()
    const row = mockFailedEmailCreate.mock.calls[0][0].data
    expect(row.toEmail).toBe('alice@example.com')
    expect(row.template).toBe('verification_code')
    expect(row.attempts).toBe(8)
    expect(row.lastError).toBe('quota exceeded')
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('jobIdForEmail', () => {
  it('is deterministic for the same verification payload', () => {
    expect(__jobIdForEmail(verificationJob)).toBe(__jobIdForEmail(verificationJob))
  })

  it('differs across templates and codes', () => {
    const a = __jobIdForEmail(verificationJob)
    const b = __jobIdForEmail({ ...verificationJob, code: '999999' })
    const c = __jobIdForEmail(resetJob)
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('getEmailDispatcher selector', () => {
  beforeEach(() => {
    __resetEmailDispatcher()
  })
  afterEach(() => {
    __resetEmailDispatcher()
    delete process.env.REDIS_URL
  })

  it('returns InProcessEmailDispatcher when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL
    const d = getEmailDispatcher()
    expect(d).toBeInstanceOf(InProcessEmailDispatcher)
  })

  it('caches the selected dispatcher across calls', () => {
    delete process.env.REDIS_URL
    const a = getEmailDispatcher()
    const b = getEmailDispatcher()
    expect(a).toBe(b)
  })
})
