import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '../audit'

let testUserId: string

beforeEach(async () => {
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'AuditTest' } } })

  const user = await prisma.user.create({
    data: { fullName: 'AuditTest User' },
  })
  testUserId = user.id
})

afterAll(async () => {
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'AuditTest' } } })
})

describe('auth audit service', () => {
  it('persists an auth event with timestamp', async () => {
    await logAuthEvent({
      userId: testUserId,
      event: 'LOGIN',
      ip: '192.168.1.1',
    })
    const events = await prisma.authEvent.findMany({
      where: { userId: testUserId },
    })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('LOGIN')
    expect(events[0].ip).toBe('192.168.1.1')
    expect(events[0].createdAt).toBeInstanceOf(Date)
  })

  it('stores metadata as JSON', async () => {
    await logAuthEvent({
      userId: testUserId,
      event: 'LOGIN_FAILED',
      metadata: { reason: 'wrong password', attempts: 3 },
    })
    const events = await prisma.authEvent.findMany({
      where: { userId: testUserId, event: 'LOGIN_FAILED' },
    })
    expect(events).toHaveLength(1)
    const meta = events[0].metadata as Record<string, unknown>
    expect(meta.reason).toBe('wrong password')
    expect(meta.attempts).toBe(3)
  })

  it('stores event without optional fields', async () => {
    await logAuthEvent({
      userId: testUserId,
      event: 'LOGOUT',
    })
    const events = await prisma.authEvent.findMany({
      where: { userId: testUserId, event: 'LOGOUT' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].ip).toBeNull()
    expect(events[0].metadata).toBeNull()
  })
})
