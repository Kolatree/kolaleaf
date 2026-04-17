import { describe, it, expect, vi, beforeEach } from 'vitest'

// prisma.$transaction is invoked with an async callback. We capture that
// callback, build a `tx` proxy with the same method shape as the
// top-level prisma mock, and run the callback so each tx.X call lands on
// the same vi.fn() the test can assert against.
// Hoisted so `vi.mock` can reference it; vi.mock calls are elevated
// above all other top-level code at transform time.
const tx = vi.hoisted(() => ({
  pendingEmailVerification: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  userIdentifier: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    create: vi.fn(),
  },
  session: {
    create: vi.fn(),
  },
  authEvent: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
}))

// Top-level prisma (outside the tx) — the route calls
// userIdentifier.findUnique / session.create / authEvent.create outside
// the tx for the idempotent-retry short-circuit (check existing
// verified UserIdentifier → re-issue session without re-entering the tx).
// Hoisted so `vi.mock` can see it (vi.mock calls are elevated above
// all other top-level code at transform time).
const topPrisma = vi.hoisted(() => ({
  $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  userIdentifier: {
    findUnique: vi.fn(),
  },
  session: {
    create: vi.fn(),
  },
  authEvent: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
}))

vi.mock('@/lib/db/client', () => ({
  prisma: topPrisma,
}))

vi.mock('@/lib/auth/middleware', () => ({
  setSessionCookie: vi.fn(() => 'kolaleaf_session=sess-tok; HttpOnly'),
}))

vi.mock('@/lib/auth/password', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    // verifyPassword is only called on the idempotent-retry path; default
    // to false so tests that don't set up that path don't accidentally
    // hit the retry short-circuit.
    verifyPassword: vi.fn(async () => false),
  }
})

import { POST } from '@/app/api/v1/auth/complete-registration/route'
import { setSessionCookie } from '@/lib/auth/middleware'

const mockCookie = vi.mocked(setSessionCookie)

const VALID_PW = 'TestPass123!'
const VALID_BODY = {
  email: 'a@b.com',
  fullName: 'Test User',
  password: VALID_PW,
  addressLine1: '1 George St',
  addressLine2: 'Apt 5',
  city: 'Sydney',
  state: 'NSW',
  postcode: '2000',
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/complete-registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockVerifiedClaim(overrides: Record<string, unknown> = {}) {
  tx.pendingEmailVerification.findUnique.mockResolvedValueOnce({
    id: 'p1',
    email: 'a@b.com',
    codeHash: 'h',
    expiresAt: new Date(Date.now() + 1000),
    attempts: 0,
    verifiedAt: new Date(Date.now() - 1000),
    claimExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  } as never)
}

function setUpSuccessPath() {
  mockVerifiedClaim()
  tx.userIdentifier.findUnique.mockResolvedValueOnce(null)
  tx.user.create.mockResolvedValueOnce({
    id: 'u1',
    fullName: 'Test User',
  } as never)
  tx.userIdentifier.create.mockResolvedValueOnce({} as never)
  tx.session.create.mockResolvedValueOnce({ token: 'sess-tok' } as never)
  tx.authEvent.create.mockResolvedValue({} as never)
  tx.authEvent.createMany.mockResolvedValueOnce({ count: 2 } as never)
  tx.pendingEmailVerification.delete.mockResolvedValueOnce({} as never)
}

describe('POST /api/v1/auth/complete-registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie.mockReturnValue('kolaleaf_session=sess-tok; HttpOnly')
    // Default: no existing verified identifier, so the idempotent-retry
    // short-circuit never fires and tests proceed through the tx.
    topPrisma.userIdentifier.findUnique.mockResolvedValue(null)
    // Wire the $transaction to invoke the route's callback against our
    // shared `tx` proxy. The second argument (options) is ignored —
    // we only care about capturing the callback behaviour.
    topPrisma.$transaction.mockImplementation(
      async (cb: (ctx: typeof tx) => unknown) => cb(tx),
    )
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/auth/complete-registration', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when the pending claim does not exist', async () => {
    tx.pendingEmailVerification.findUnique.mockResolvedValueOnce(null)
    const res = await POST(postRequest(VALID_BODY))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/verif/i)
    expect(tx.user.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the pending row exists but was not verified', async () => {
    mockVerifiedClaim({ verifiedAt: null, claimExpiresAt: null })
    const res = await POST(postRequest(VALID_BODY))
    expect(res.status).toBe(400)
    expect(tx.user.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the claim window has expired', async () => {
    mockVerifiedClaim({
      verifiedAt: new Date(Date.now() - 60 * 60 * 1000),
      claimExpiresAt: new Date(Date.now() - 1000),
    })
    const res = await POST(postRequest(VALID_BODY))
    expect(res.status).toBe(400)
    expect(tx.user.create).not.toHaveBeenCalled()
  })

  it('returns 422 when full name is missing or too short (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, fullName: 'a' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.fullName).toBeInstanceOf(Array)
  })

  it('returns 422 when password is shorter than 12 chars (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, password: 'short' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.password).toBeInstanceOf(Array)
  })

  it('returns 422 when addressLine1 is missing or too short (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, addressLine1: 'ab' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.addressLine1).toBeInstanceOf(Array)
  })

  it('returns 422 when city is missing (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, city: '' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.city).toBeInstanceOf(Array)
  })

  it('returns 422 when state is not an AU state (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, state: 'CA' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.state).toBeInstanceOf(Array)
  })

  it('returns 422 when postcode is not 4 digits (schema)', async () => {
    mockVerifiedClaim()
    const res = await POST(postRequest({ ...VALID_BODY, postcode: '200' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.postcode).toBeInstanceOf(Array)
  })

  it('returns 422 with multiple field errors at once (batches via Zod)', async () => {
    // Legacy ad-hoc pattern returned at the FIRST failed guard. Zod
    // reports every failure in one 422 response — confirms the new
    // contract.
    mockVerifiedClaim()
    const res = await POST(
      postRequest({
        ...VALID_BODY,
        email: 'bad',
        postcode: 'xxx',
        state: 'XYZ',
      }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.email).toBeInstanceOf(Array)
    expect(json.fields?.postcode).toBeInstanceOf(Array)
    expect(json.fields?.state).toBeInstanceOf(Array)
  })

  it('returns 409 when the email is already owned by a verified user (race)', async () => {
    mockVerifiedClaim()
    tx.userIdentifier.findUnique.mockResolvedValueOnce({
      id: 'id1',
      userId: 'other',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: true,
    } as never)

    const res = await POST(postRequest(VALID_BODY))
    expect(res.status).toBe(409)
  })

  it('creates User + UserIdentifier + Session, writes REGISTER and LOGIN, deletes pending row, sets cookie', async () => {
    setUpSuccessPath()

    const res = await POST(postRequest(VALID_BODY))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.user).toEqual({ id: 'u1', fullName: 'Test User' })
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session=sess-tok')

    // User written with the normalised email, all address fields, country=AU.
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: 'Test User',
          passwordHash: expect.any(String),
          addressLine1: '1 George St',
          addressLine2: 'Apt 5',
          city: 'Sydney',
          state: 'NSW',
          postcode: '2000',
          country: 'AU',
        }),
      }),
    )
    // Identifier is created verified.
    expect(tx.userIdentifier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          type: 'EMAIL',
          identifier: 'a@b.com',
          verified: true,
          verifiedAt: expect.any(Date),
        }),
      }),
    )
    expect(tx.session.create).toHaveBeenCalled()
    expect(tx.pendingEmailVerification.delete).toHaveBeenCalledWith({
      where: { email: 'a@b.com' },
    })

    // Both audit events must be written — now via createMany so it's a
    // single DB round-trip inside the tx.
    expect(tx.authEvent.createMany).toHaveBeenCalledTimes(1)
    const batch = (tx.authEvent.createMany.mock.calls[0][0] as { data: { event: string }[] }).data
    const eventNames = batch.map((e) => e.event)
    expect(eventNames).toContain('REGISTER')
    expect(eventNames).toContain('LOGIN')
    expect(mockCookie).toHaveBeenCalledWith('sess-tok')
  })

  it('omits addressLine2 cleanly when not provided', async () => {
    setUpSuccessPath()

    const body = { ...VALID_BODY }
    delete (body as { addressLine2?: string }).addressLine2

    const res = await POST(postRequest(body))
    expect(res.status).toBe(201)

    const call = tx.user.create.mock.calls[0][0] as { data: { addressLine2: string | null } }
    // Route must normalise missing addressLine2 to `null`, never `''` —
    // an empty string would round-trip through Prisma into the column as
    // a zero-length entry instead of the intended SQL NULL.
    expect(call.data.addressLine2).toBeNull()
  })

  it('normalises email before lookup and persistence', async () => {
    setUpSuccessPath()

    const res = await POST(postRequest({ ...VALID_BODY, email: 'A@B.COM' }))
    expect(res.status).toBe(201)
    expect(tx.pendingEmailVerification.findUnique).toHaveBeenCalledWith({
      where: { email: 'a@b.com' },
    })
    expect(tx.pendingEmailVerification.delete).toHaveBeenCalledWith({
      where: { email: 'a@b.com' },
    })
  })
})
