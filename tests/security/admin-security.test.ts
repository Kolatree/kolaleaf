import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  prisma,
  registerTestUser,
  sessionCookie,
  cleanupTestData,
} from '../e2e/helpers'
import { requireAdmin } from '../../src/lib/auth/admin-middleware'
import { requireAuth, requireKyc, AuthError } from '../../src/lib/auth/middleware'
import { logAuthEvent } from '../../src/lib/auth/audit'

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

function makeRequest(cookieHeader?: string): Request {
  const headers = new Headers()
  if (cookieHeader) {
    headers.set('cookie', cookieHeader)
  }
  return new Request('http://localhost/api/v1/admin/test', { headers })
}

describe('Admin Security', () => {
  it('non-admin user gets 403 from requireAdmin', async () => {
    const { token } = await registerTestUser()

    const request = makeRequest(sessionCookie(token))

    await expect(requireAdmin(request)).rejects.toThrow(AuthError)
    try {
      await requireAdmin(request)
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).statusCode).toBe(403)
      expect((error as AuthError).message).toBe('Admin access required')
    }
  })

  it('admin user (with matching ADMIN_EMAILS) passes requireAdmin', async () => {
    const adminEmail = `admin-${Date.now()}@kolaleaf.com`
    const { user, token } = await registerTestUser({ email: adminEmail })

    const originalEnv = process.env.ADMIN_EMAILS
    process.env.ADMIN_EMAILS = adminEmail

    try {
      const request = makeRequest(sessionCookie(token))
      const result = await requireAdmin(request)
      expect(result.userId).toBe(user.id)
    } finally {
      process.env.ADMIN_EMAILS = originalEnv
    }
  })

  it('unauthenticated request gets 401', async () => {
    // No cookie at all
    const request = makeRequest()

    await expect(requireAuth(request)).rejects.toThrow(AuthError)
    try {
      await requireAuth(request)
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).statusCode).toBe(401)
    }
  })

  it('invalid session token gets 401', async () => {
    const fakeToken = crypto.randomBytes(32).toString('hex')
    const request = makeRequest(sessionCookie(fakeToken))

    await expect(requireAuth(request)).rejects.toThrow(AuthError)
    try {
      await requireAuth(request)
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).statusCode).toBe(401)
    }
  })

  it('expired session token gets 401 from requireAuth', async () => {
    const { user } = await registerTestUser()

    // Create an expired session
    const expiredToken = crypto.randomBytes(32).toString('hex')
    await prisma.session.create({
      data: {
        userId: user.id,
        token: expiredToken,
        expiresAt: new Date(Date.now() - 60000), // expired
      },
    })

    const request = makeRequest(sessionCookie(expiredToken))
    await expect(requireAuth(request)).rejects.toThrow(AuthError)
  })

  it('requireKyc rejects non-VERIFIED user with 403', async () => {
    const { token } = await registerTestUser({ kycStatus: 'PENDING' })
    const request = makeRequest(sessionCookie(token))

    await expect(requireKyc(request)).rejects.toThrow(AuthError)
    try {
      await requireKyc(request)
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).statusCode).toBe(403)
      expect((error as AuthError).message).toBe('KYC verification required')
    }
  })

  it('requireKyc passes for VERIFIED user', async () => {
    const { user, token } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const request = makeRequest(sessionCookie(token))

    const result = await requireKyc(request)
    expect(result.userId).toBe(user.id)
  })

  it('admin actions are logged with actor identity', async () => {
    const adminEmail = `audit-admin-${Date.now()}@kolaleaf.com`
    const { user } = await registerTestUser({ email: adminEmail })

    // Log an admin action
    await logAuthEvent({
      userId: user.id,
      event: 'ADMIN_TRANSFER_REFUND',
      ip: '192.168.1.1',
      metadata: { transferId: 'trx-123', action: 'refund' },
    })

    const event = await prisma.authEvent.findFirst({
      where: { userId: user.id, event: 'ADMIN_TRANSFER_REFUND' },
    })
    expect(event).not.toBeNull()
    expect(event!.userId).toBe(user.id)
    expect(event!.ip).toBe('192.168.1.1')
    expect(event!.metadata).toEqual({ transferId: 'trx-123', action: 'refund' })
  })

  it('ADMIN_EMAILS env parsing handles comma-separated, trimmed, lowercased', async () => {
    const email1 = `admin-a-${Date.now()}@kolaleaf.com`
    const email2 = `admin-b-${Date.now()}@kolaleaf.com`

    const { user: userA, token: tokenA } = await registerTestUser({ email: email1 })
    const { user: userB, token: tokenB } = await registerTestUser({ email: email2 })

    const originalEnv = process.env.ADMIN_EMAILS
    // Spaces, mixed case
    process.env.ADMIN_EMAILS = `  ${email1.toUpperCase()} , ${email2}  `

    try {
      const requestA = makeRequest(sessionCookie(tokenA))
      const resultA = await requireAdmin(requestA)
      expect(resultA.userId).toBe(userA.id)

      const requestB = makeRequest(sessionCookie(tokenB))
      const resultB = await requireAdmin(requestB)
      expect(resultB.userId).toBe(userB.id)
    } finally {
      process.env.ADMIN_EMAILS = originalEnv
    }
  })
})
