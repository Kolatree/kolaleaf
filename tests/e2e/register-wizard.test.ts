import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import { prisma, cleanupTestData } from './helpers'

// End-to-end through the three wizard endpoints against the real DB. We
// spy on the email renderer so we can see the 6-digit code the random
// generator produced — same technique as the logged-in verify flow uses.
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
  return {
    ...actual,
    sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'evt' }),
  }
})

// Keep a handle on the raw codes issued so the verify step can consume them.
const capturedCodes: string[] = []
vi.mock('@/lib/auth/tokens', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/tokens')>(
    '@/lib/auth/tokens',
  )
  return {
    ...actual,
    generateVerificationCode: () => {
      const raw = String(Math.floor(100000 + Math.random() * 900000))
      const hash = actual.hashToken(raw)
      capturedCodes.push(raw)
      return { raw, hash }
    },
  }
})

import { POST as sendCode } from '@/app/api/v1/auth/send-code/route'
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route'
import { POST as completeRegistration } from '@/app/api/v1/auth/complete-registration/route'

beforeAll(async () => {
  await cleanupTestData()
  await prisma.pendingEmailVerification.deleteMany({})
})

afterEach(async () => {
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.pendingEmailVerification.deleteMany({})
  capturedCodes.length = 0
})

afterAll(async () => {
  await cleanupTestData()
})

function req(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Register wizard E2E', () => {
  it('send-code → verify-code → complete-registration produces a verified user + session', async () => {
    const email = `wiz-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@test.com`

    // Step 1: send-code
    // /send-code now dispatches the code fire-and-forget (moved off
    // the request path for latency). Wait for the background handler
    // to land the row + push the captured code before asserting.
    const r1 = await sendCode(req('/api/v1/auth/send-code', { email }))
    expect(r1.status).toBe(200)
    await vi.waitFor(() => expect(capturedCodes).toHaveLength(1))
    const code = capturedCodes[0]

    // A PendingEmailVerification row exists, unverified.
    const pending = await prisma.pendingEmailVerification.findUnique({
      where: { email: email.toLowerCase() },
    })
    expect(pending).not.toBeNull()
    expect(pending!.verifiedAt).toBeNull()

    // Step 2: verify-code
    const r2 = await verifyCode(req('/api/v1/auth/verify-code', { email, code }))
    expect(r2.status).toBe(200)
    const r2body = await r2.json()
    expect(r2body.verified).toBe(true)
    expect(r2.headers.get('Set-Cookie')).toBeNull()

    // The row is now verified with a claim window.
    const pendingVerified = await prisma.pendingEmailVerification.findUnique({
      where: { email: email.toLowerCase() },
    })
    expect(pendingVerified!.verifiedAt).not.toBeNull()
    expect(pendingVerified!.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now())

    // Step 3: complete-registration
    const r3 = await completeRegistration(
      req('/api/v1/auth/complete-registration', {
        email,
        fullName: 'E2E Wizard User',
        password: 'WizardPass123!',
        addressLine1: '1 Wizard Way',
        addressLine2: 'Suite 4',
        city: 'Sydney',
        state: 'NSW',
        postcode: '2000',
      }),
    )
    expect(r3.status).toBe(201)
    const r3body = await r3.json()
    expect(r3body.user.id).toBeTruthy()
    expect(r3body.user.fullName).toBe('E2E Wizard User')
    const setCookie = r3.headers.get('Set-Cookie')
    expect(setCookie).toContain('kolaleaf_session=')

    // User row + verified identifier + session + audit trail all landed.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: r3body.user.id } })
    expect(user.addressLine1).toBe('1 Wizard Way')
    expect(user.addressLine2).toBe('Suite 4')
    expect(user.city).toBe('Sydney')
    expect(user.state).toBe('NSW')
    expect(user.postcode).toBe('2000')
    expect(user.country).toBe('AU')

    const ident = await prisma.userIdentifier.findUniqueOrThrow({
      where: { identifier: email.toLowerCase() },
    })
    expect(ident.verified).toBe(true)
    expect(ident.userId).toBe(user.id)

    const sessions = await prisma.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)

    const events = await prisma.authEvent.findMany({ where: { userId: user.id } })
    const eventNames = events.map((e) => e.event).sort()
    // 'REGISTER' matches the string emitted by the legacy service layer —
    // a single canonical name lets AUSTRAC audit queries find every
    // account regardless of signup path.
    expect(eventNames).toEqual(['LOGIN', 'REGISTER'])

    // Pending row was consumed.
    const pendingAfter = await prisma.pendingEmailVerification.findUnique({
      where: { email: email.toLowerCase() },
    })
    expect(pendingAfter).toBeNull()
  })

  it('duplicate email on step 1 is silently a no-op — no second code issued', async () => {
    const email = `dup-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@test.com`

    // Seed a verified user with this email.
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('AnyPass123!', 12)
    await prisma.user.create({
      data: {
        fullName: 'Existing User',
        passwordHash,
        identifiers: {
          create: {
            type: 'EMAIL',
            identifier: email.toLowerCase(),
            verified: true,
            verifiedAt: new Date(),
          },
        },
      },
    })

    const r = await sendCode(req('/api/v1/auth/send-code', { email }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)

    // No pending row was created, no code was generated.
    const pending = await prisma.pendingEmailVerification.findUnique({
      where: { email: email.toLowerCase() },
    })
    expect(pending).toBeNull()
    expect(capturedCodes).toHaveLength(0)
  })

  it('complete-registration without verify is rejected 400', async () => {
    const email = `unv-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@test.com`

    await sendCode(req('/api/v1/auth/send-code', { email }))
    await vi.waitFor(() => expect(capturedCodes).toHaveLength(1))
    // Do NOT call verify-code.

    const r = await completeRegistration(
      req('/api/v1/auth/complete-registration', {
        email,
        fullName: 'Skipper',
        password: 'WizardPass123!',
        addressLine1: '1 Wizard Way',
        city: 'Sydney',
        state: 'NSW',
        postcode: '2000',
      }),
    )
    expect(r.status).toBe(400)

    // And no user was created.
    const ident = await prisma.userIdentifier.findUnique({
      where: { identifier: email.toLowerCase() },
    })
    expect(ident).toBeNull()
  })
})
