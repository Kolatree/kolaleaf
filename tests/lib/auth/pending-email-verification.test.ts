import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pendingEmailVerification: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'evt' }),
  renderVerificationEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}))

import {
  issuePendingEmailCode,
  verifyPendingEmailCode,
  PENDING_CODE_TTL_MINUTES,
  PENDING_CODE_MAX_ATTEMPTS,
  PENDING_CLAIM_WINDOW_MINUTES,
} from '@/lib/auth/pending-email-verification'
import { hashToken } from '@/lib/auth/tokens'
import { prisma } from '@/lib/db/client'
import { sendEmail } from '@/lib/email'

const mockSend = vi.mocked(sendEmail)
const mockUpsert = vi.mocked(prisma.pendingEmailVerification.upsert)
const mockFindUnique = vi.mocked(prisma.pendingEmailVerification.findUnique)
const mockUpdate = vi.mocked(prisma.pendingEmailVerification.update)

describe('issuePendingEmailCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ ok: true, id: 'evt' })
  })

  // Rows returned by findUnique in these tests model a row already on
  // disk. `null` = no prior row for this email.
  const existingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    email: 'a@b.com',
    codeHash: 'old',
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    verifiedAt: null,
    claimExpiresAt: null,
    sendCount: 0,
    sendWindowStart: new Date(),
    createdAt: new Date(),
    ...overrides,
  })

  it('returns rate_limited when sendCount has hit the cap inside the active window', async () => {
    // Window still open (started 10 min ago), cap already reached.
    mockFindUnique.mockResolvedValueOnce(
      existingRow({
        sendCount: 5,
        sendWindowStart: new Date(Date.now() - 10 * 60 * 1000),
      }) as never,
    )
    const result = await issuePendingEmailCode({ email: 'a@b.com' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited')
      // retryAfterMs should be a positive value ≤ 1 hour.
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.retryAfterMs).toBeLessThanOrEqual(60 * 60 * 1000)
    }
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('resets the send window when the last send was > 1 hour ago', async () => {
    // Window opened > 1h ago — new send must reset count to 1.
    mockFindUnique.mockResolvedValueOnce(
      existingRow({
        sendCount: 5,
        sendWindowStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }) as never,
    )
    mockUpsert.mockResolvedValueOnce({ id: 'p1' } as never)

    const result = await issuePendingEmailCode({ email: 'a@b.com' })
    expect(result.ok).toBe(true)

    const call = mockUpsert.mock.calls[0][0] as {
      update: { sendCount: number; sendWindowStart: Date }
    }
    expect(call.update.sendCount).toBe(1)
    // Window restarted "now" — must be within the last few seconds.
    const driftMs = Date.now() - call.update.sendWindowStart.getTime()
    expect(driftMs).toBeGreaterThanOrEqual(0)
    expect(driftMs).toBeLessThan(5000)
  })

  it('increments sendCount when still inside the window and under cap', async () => {
    const priorWindowStart = new Date(Date.now() - 5 * 60 * 1000)
    mockFindUnique.mockResolvedValueOnce(
      existingRow({ sendCount: 2, sendWindowStart: priorWindowStart }) as never,
    )
    mockUpsert.mockResolvedValueOnce({ id: 'p1' } as never)

    const result = await issuePendingEmailCode({ email: 'a@b.com' })
    expect(result.ok).toBe(true)

    const call = mockUpsert.mock.calls[0][0] as {
      update: { sendCount: number; sendWindowStart: Date }
    }
    expect(call.update.sendCount).toBe(3)
    // Window start carried over unchanged from the existing row.
    expect(call.update.sendWindowStart).toBe(priorWindowStart)
  })

  it('upserts a fresh row with attempts=0, clears verifiedAt, sends email', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ id: 'p1' } as never)

    const result = await issuePendingEmailCode({ email: 'a@b.com' })

    expect(result.ok).toBe(true)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const call = mockUpsert.mock.calls[0][0] as {
      where: { email: string }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(call.where.email).toBe('a@b.com')
    expect(call.create.email).toBe('a@b.com')
    expect(call.create.attempts).toBe(0)
    expect(call.create.verifiedAt).toBeNull()
    expect(call.create.claimExpiresAt).toBeNull()
    expect(call.create.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(call.create.expiresAt).toBeInstanceOf(Date)
    expect(call.create.sendCount).toBe(1)
    expect(call.create.sendWindowStart).toBeInstanceOf(Date)
    // Re-issue path resets identity of the row (same shape as create for the
    // refresh-it-all-every-send model): attempts back to 0, verifiedAt null.
    expect(call.update.attempts).toBe(0)
    expect(call.update.verifiedAt).toBeNull()
    expect(call.update.claimExpiresAt).toBeNull()
    expect(call.update.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('uses a recipient-neutral name in the email template (no User row exists yet)', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ id: 'p1' } as never)
    const { renderVerificationEmail } = await import('@/lib/email')
    const mockRender = vi.mocked(renderVerificationEmail)

    await issuePendingEmailCode({ email: 'a@b.com' })

    expect(mockRender).toHaveBeenCalled()
    const rendered = mockRender.mock.calls[0][0]
    // Brief says no User exists yet, so we cannot greet by name. Use a
    // neutral salutation that still reads warmly.
    expect(rendered.recipientName).toBe('there')
    expect(rendered.expiresInMinutes).toBe(PENDING_CODE_TTL_MINUTES)
  })

  it('stores sha256(code), never the raw code', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ id: 'p1' } as never)

    await issuePendingEmailCode({ email: 'a@b.com' })

    const call = mockUpsert.mock.calls[0][0] as { create: { codeHash: string } }
    expect(call.create.codeHash).toHaveLength(64)
    expect(call.create.codeHash).not.toMatch(/^\d{6}$/)
  })
})

describe('verifyPendingEmailCode', () => {
  const future = () => new Date(Date.now() + PENDING_CODE_TTL_MINUTES * 60 * 1000)
  const past = () => new Date(Date.now() - 1000)
  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    email: 'a@b.com',
    codeHash: hashToken('123456'),
    expiresAt: future(),
    attempts: 0,
    verifiedAt: null,
    claimExpiresAt: null,
    createdAt: new Date(),
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no_token when nothing found', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('no_token')
  })

  it('returns expired when expiresAt is past and not yet verified', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRow({ expiresAt: past() }) as never)
    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('expired')
  })

  it('returns used when already verified and the claim window has closed', async () => {
    mockFindUnique.mockResolvedValueOnce(
      baseRow({ verifiedAt: new Date(), claimExpiresAt: past() }) as never,
    )
    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('used')
  })

  it('returns too_many_attempts before hashing when attempts >= cap', async () => {
    mockFindUnique.mockResolvedValueOnce(
      baseRow({ attempts: PENDING_CODE_MAX_ATTEMPTS }) as never,
    )
    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_many_attempts')
  })

  it('returns wrong_code and increments attempts on mismatch', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRow() as never)
    mockUpdate.mockResolvedValueOnce({ attempts: 1 } as never)

    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '999999' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('wrong_code')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { attempts: { increment: 1 } },
    })
  })

  it('burns the token on the Nth wrong attempt in a single atomic update', async () => {
    mockFindUnique.mockResolvedValueOnce(
      baseRow({ attempts: PENDING_CODE_MAX_ATTEMPTS - 1 }) as never,
    )
    mockUpdate.mockResolvedValueOnce({} as never)

    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '999999' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_many_attempts')

    // Increment AND burn must land in a single write — not two sequential
    // updates — so there is no intermediate state where `attempts` has
    // landed but `expiresAt` has not. No `usedAt` column on this model;
    // burn is via `expiresAt` in the past.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const call = mockUpdate.mock.calls[0][0] as {
      where: { id: string }
      data: { attempts?: unknown; expiresAt?: Date }
    }
    expect(call.where.id).toBe('p1')
    expect(call.data.attempts).toEqual({ increment: 1 })
    expect(call.data.expiresAt).toBeInstanceOf(Date)
    expect(call.data.expiresAt!.getTime()).toBeLessThan(Date.now())
  })

  it('under the cap, a wrong attempt only increments — no burn', async () => {
    mockFindUnique.mockResolvedValueOnce(
      baseRow({ attempts: PENDING_CODE_MAX_ATTEMPTS - 2 }) as never,
    )
    mockUpdate.mockResolvedValueOnce({} as never)

    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '999999' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('wrong_code')

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const call = mockUpdate.mock.calls[0][0] as { data: { expiresAt?: Date } }
    expect(call.data.expiresAt).toBeUndefined()
  })

  it('on success sets verifiedAt + claimExpiresAt and returns verified=true', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRow() as never)
    mockUpdate.mockResolvedValueOnce({} as never)

    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(true)

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        verifiedAt: expect.any(Date),
        claimExpiresAt: expect.any(Date),
      },
    })
    const updatedClaim = mockUpdate.mock.calls[0][0] as {
      data: { claimExpiresAt: Date }
    }
    // claimExpiresAt ≈ now + PENDING_CLAIM_WINDOW_MINUTES
    const expectedMs = PENDING_CLAIM_WINDOW_MINUTES * 60 * 1000
    const delta = Math.abs(
      updatedClaim.data.claimExpiresAt.getTime() - (Date.now() + expectedMs),
    )
    expect(delta).toBeLessThan(5000)
  })

  it('verifying again within the claim window is idempotent success (not `used`)', async () => {
    // After step 2 succeeds once, the UI must be able to tolerate a duplicate
    // submit without flipping to `used`, because the claim window is still
    // open and step 3 hasn't happened yet.
    const alreadyVerified = baseRow({
      verifiedAt: new Date(Date.now() - 1000),
      claimExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })
    mockFindUnique.mockResolvedValueOnce(alreadyVerified as never)

    const out = await verifyPendingEmailCode({ email: 'a@b.com', code: '123456' })
    expect(out.ok).toBe(true)
  })
})
