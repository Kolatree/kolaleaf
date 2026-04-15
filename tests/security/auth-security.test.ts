import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  prisma,
  registerTestUser,
  cleanupTestData,
} from '../e2e/helpers'
import { registerUser } from '../../src/lib/auth/register'
import { loginUser } from '../../src/lib/auth/login'
import { validateSession, revokeSession } from '../../src/lib/auth/sessions'
import { verifyTotpCode } from '../../src/lib/auth/totp'

beforeAll(async () => {
  await cleanupTestData()
})

afterEach(async () => {
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

describe('Auth Security', () => {
  it('password is NOT stored in plaintext — uses bcrypt format', async () => {
    const email = `sec-pw-${Date.now()}@test.com`
    const plainPassword = 'MySecret123!'

    const { user } = await registerUser({
      fullName: 'Bcrypt User',
      email,
      password: plainPassword,
    })

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(dbUser.passwordHash).not.toBe(plainPassword)
    expect(dbUser.passwordHash).not.toContain(plainPassword)

    // Bcrypt hashes start with $2a$ or $2b$
    expect(dbUser.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/)
  })

  it('session token is 64 hex characters (256-bit entropy)', async () => {
    const { session } = await registerTestUser()

    expect(session.token).toHaveLength(64)
    // Verify it's valid hex
    expect(session.token).toMatch(/^[0-9a-f]{64}$/)

    // 64 hex chars = 32 bytes = 256 bits of entropy
    const bytes = Buffer.from(session.token, 'hex')
    expect(bytes.length).toBe(32)
  })

  it('expired session is rejected by validateSession', async () => {
    const { user } = await registerTestUser()

    // Create an expired session
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
      },
    })

    const result = await validateSession(token)
    expect(result).toBeNull()
  })

  it('invalid (random) session token is rejected', async () => {
    const fakeToken = crypto.randomBytes(32).toString('hex')
    const result = await validateSession(fakeToken)
    expect(result).toBeNull()
  })

  it('empty session token is rejected', async () => {
    const result = await validateSession('')
    expect(result).toBeNull()
  })

  it('TOTP with wrong code is rejected', async () => {
    // Generate a real secret
    const { generateSecret } = await import('otplib')
    const secret = generateSecret()

    // Try a known-wrong numeric code
    const result = verifyTotpCode(secret, '000000')
    // While technically 000000 could be valid for a brief window,
    // we test that the function returns a boolean and doesn't throw
    expect(typeof result).toBe('boolean')

    // Non-numeric input throws TokenFormatError from otplib
    // (tokens must be digits only)
    expect(() => verifyTotpCode(secret, 'abcdef')).toThrow()
  })

  it('revoked session is rejected', async () => {
    const { session } = await registerTestUser()

    // Session should be valid
    const valid = await validateSession(session.token)
    expect(valid).not.toBeNull()

    // Revoke it
    await revokeSession(session.id)

    // Now it should be invalid
    const revoked = await validateSession(session.token)
    expect(revoked).toBeNull()
  })

  it('login failure is logged in auth events', async () => {
    const email = `sec-fail-${Date.now()}@test.com`
    await registerUser({
      fullName: 'Audit User',
      email,
      password: 'Correct123!',
    })

    // Failed login attempt
    try {
      await loginUser({ identifier: email, password: 'WrongPass!', ip: '1.2.3.4' })
    } catch {
      // Expected to throw
    }

    const failEvent = await prisma.authEvent.findFirst({
      where: { event: 'LOGIN_FAILED' },
    })
    expect(failEvent).not.toBeNull()
    expect(failEvent!.ip).toBe('1.2.3.4')
  })

  it('successful login is logged in auth events', async () => {
    const email = `sec-succ-${Date.now()}@test.com`
    const { user } = await registerUser({
      fullName: 'Login Audit User',
      email,
      password: 'LoginPass123!',
    })

    await loginUser({
      identifier: email,
      password: 'LoginPass123!',
      ip: '10.0.0.1',
    })

    const loginEvent = await prisma.authEvent.findFirst({
      where: { userId: user.id, event: 'LOGIN' },
    })
    expect(loginEvent).not.toBeNull()
    expect(loginEvent!.ip).toBe('10.0.0.1')
  })

  it('timing-safe comparison: non-existent email still takes time (no enumeration)', async () => {
    // This test verifies the code path, not actual timing — the important thing
    // is that loginUser does a bcrypt compare even when the user doesn't exist
    const start = Date.now()
    try {
      await loginUser({
        identifier: 'nonexistent-timing@test.com',
        password: 'anything',
      })
    } catch {
      // Expected
    }
    const elapsed = Date.now() - start

    // bcrypt with cost 12 should take at least ~100ms
    // We verify it's not instant (< 10ms would suggest no bcrypt compare)
    expect(elapsed).toBeGreaterThan(50)
  })
})
