import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    passwordResetToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
    // Under test, $transaction just executes the array. We assert the
    // constituent operations were queued via their individual mocks.
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn(async () => 'new_hash'),
    verifyPassword: vi.fn(),
  }
})

import { POST } from '@/app/api/v1/auth/reset-password/route'
import { prisma } from '@/lib/db/client'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 422 when token missing (Zod)', async () => {
    const res = await POST(makeRequest({ newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.token).toBeInstanceOf(Array)
  })

  it('returns 422 when newPassword missing (Zod)', async () => {
    const res = await POST(makeRequest({ token: 'a'.repeat(64) }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.newPassword).toBeInstanceOf(Array)
  })

  it('returns 422 for weak password (too short) (Zod)', async () => {
    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'short' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid/expired/used token with generic message', async () => {
    ;(prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid or expired/i)
  })

  it('returns 400 for expired token', async () => {
    ;(prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    })
    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for already-used token', async () => {
    ;(prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    })
    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(400)
  })

  it('resets password, marks token used, and deletes all user sessions on success', async () => {
    ;(prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    })
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'u1' })
    ;(prisma.passwordResetToken.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})
    ;(prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 3 })

    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(200)

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ passwordHash: 'new_hash' }),
      }),
    )
    expect(prisma.passwordResetToken.update).toHaveBeenCalled()
    expect(prisma.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
    // Atomicity: all three writes must go through $transaction.
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).toHaveBeenCalledTimes(1)
  })

  it('returns 500 and does NOT log a PASSWORD_RESET AuthEvent if the transaction fails', async () => {
    ;(prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    })
    // Simulate a mid-transaction failure (e.g. session deleteMany errors).
    const tx = (prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction
    tx.mockRejectedValueOnce(new Error('simulated DB failure'))

    const res = await POST(makeRequest({ token: 'a'.repeat(64), newPassword: 'StrongPass123!' }))
    expect(res.status).toBe(500)
    // AuthEvent must not fire when the atomic block failed.
    expect(prisma.authEvent.create).not.toHaveBeenCalled()
  })
})
