import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { createSession } from '../sessions'

// Must set env before importing the module under test
const ADMIN_EMAIL = 'admin@kolaleaf.com'
const NON_ADMIN_EMAIL = 'user@example.com'

vi.stubEnv('ADMIN_EMAILS', `${ADMIN_EMAIL},ops@kolaleaf.com`)

// Import after env is set
const { requireAdmin } = await import('../admin-middleware')

let adminUserId: string
let nonAdminUserId: string
let adminSessionToken: string
let nonAdminSessionToken: string

beforeEach(async () => {
  await prisma.session.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'AdminTest' } } })

  const adminUser = await prisma.user.create({
    data: { fullName: 'AdminTest Admin' },
  })
  adminUserId = adminUser.id

  await prisma.userIdentifier.create({
    data: {
      userId: adminUserId,
      type: 'EMAIL',
      identifier: ADMIN_EMAIL,
      verified: true,
    },
  })

  const nonAdminUser = await prisma.user.create({
    data: { fullName: 'AdminTest Regular' },
  })
  nonAdminUserId = nonAdminUser.id

  await prisma.userIdentifier.create({
    data: {
      userId: nonAdminUserId,
      type: 'EMAIL',
      identifier: NON_ADMIN_EMAIL,
      verified: true,
    },
  })

  const adminSession = await createSession(adminUserId, '127.0.0.1')
  adminSessionToken = adminSession.token

  const nonAdminSession = await createSession(nonAdminUserId, '127.0.0.1')
  nonAdminSessionToken = nonAdminSession.token
})

afterAll(async () => {
  await prisma.session.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'AdminTest' } } })
})

function makeRequest(token?: string): Request {
  const headers = new Headers()
  if (token) {
    headers.set('cookie', `kolaleaf_session=${token}`)
  }
  return new Request('http://localhost/api/admin/test', { headers })
}

describe('requireAdmin', () => {
  it('returns userId for admin email user', async () => {
    const result = await requireAdmin(makeRequest(adminSessionToken))
    expect(result.userId).toBe(adminUserId)
  })

  it('throws 403 for non-admin email user', async () => {
    try {
      await requireAdmin(makeRequest(nonAdminSessionToken))
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      const err = error as { statusCode: number; message: string }
      expect(err.statusCode).toBe(403)
      expect(err.message).toContain('Admin access required')
    }
  })

  it('throws 401 for unauthenticated request', async () => {
    try {
      await requireAdmin(makeRequest())
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      const err = error as { statusCode: number }
      expect(err.statusCode).toBe(401)
    }
  })

  it('throws 401 for invalid session token', async () => {
    try {
      await requireAdmin(makeRequest('invalid-token'))
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      const err = error as { statusCode: number }
      expect(err.statusCode).toBe(401)
    }
  })
})
