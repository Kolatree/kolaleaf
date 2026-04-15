import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
    },
    passwordResetToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'evt_1' }),
  renderPasswordResetEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}))

import { POST } from '@/app/api/auth/request-password-reset/route'
import { prisma } from '@/lib/db/client'
import { sendEmail } from '@/lib/email'

const mockSend = vi.mocked(sendEmail)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/request-password-reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for missing email', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'notanemail' }))
    expect(res.status).toBe(400)
  })

  it('returns 200 with generic message when email does not exist (no send)', async () => {
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ email: 'nobody@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toMatch(/if an account exists/i)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 200 with generic message when email exists and sends reset email', async () => {
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'user@test.com',
      user: { id: 'u1', fullName: 'Test User' },
    })
    ;(prisma.passwordResetToken.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0)
    ;(prisma.passwordResetToken.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })
    ;(prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
    })

    const res = await POST(makeRequest({ email: 'user@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toMatch(/if an account exists/i)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('returns 200 with same message but silently skips send when rate-limited (>3 in last hour)', async () => {
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'user@test.com',
      user: { id: 'u1', fullName: 'Test User' },
    })
    ;(prisma.passwordResetToken.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3)

    const res = await POST(makeRequest({ email: 'user@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toMatch(/if an account exists/i)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
