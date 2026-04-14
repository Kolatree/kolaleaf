import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  cleanExpiredSessions,
} from '../sessions'

let testUserId: string

beforeEach(async () => {
  // Clean up previous test data
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'SessionTest' } } })

  const user = await prisma.user.create({
    data: { fullName: 'SessionTest User' },
  })
  testUserId = user.id
})

afterAll(async () => {
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'SessionTest' } } })
})

describe('session service', () => {
  it('creates a session with a 64-char hex token', async () => {
    const session = await createSession(testUserId, '127.0.0.1', 'TestAgent')
    expect(session.token).toMatch(/^[a-f0-9]{64}$/)
    expect(session.userId).toBe(testUserId)
    expect(session.ip).toBe('127.0.0.1')
    expect(session.userAgent).toBe('TestAgent')
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('validates a valid session', async () => {
    const created = await createSession(testUserId)
    const validated = await validateSession(created.token)
    expect(validated).not.toBeNull()
    expect(validated!.id).toBe(created.id)
  })

  it('returns null for expired session', async () => {
    // Create a session, then manually set it to expired
    const created = await createSession(testUserId)
    await prisma.session.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const validated = await validateSession(created.token)
    expect(validated).toBeNull()
  })

  it('returns null for invalid token', async () => {
    const validated = await validateSession('nonexistenttoken')
    expect(validated).toBeNull()
  })

  it('revokes a session by id', async () => {
    const created = await createSession(testUserId)
    await revokeSession(created.id)
    const validated = await validateSession(created.token)
    expect(validated).toBeNull()
  })

  it('revokes all sessions for a user', async () => {
    await createSession(testUserId)
    await createSession(testUserId)
    await createSession(testUserId)
    const count = await revokeAllUserSessions(testUserId)
    expect(count).toBe(3)
    const remaining = await prisma.session.count({ where: { userId: testUserId } })
    expect(remaining).toBe(0)
  })

  it('cleans only expired sessions', async () => {
    // Create one valid and one expired
    await createSession(testUserId)
    const expired = await createSession(testUserId)
    await prisma.session.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const cleaned = await cleanExpiredSessions()
    expect(cleaned).toBe(1)
    const remaining = await prisma.session.count({ where: { userId: testUserId } })
    expect(remaining).toBe(1)
  })
})
