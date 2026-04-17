import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import { prisma as testDb } from './helpers'
import { prisma as softDeletePrisma } from '@/lib/db/client'
import { cleanupLegacyUsers } from '../../scripts/cleanup-legacy-users'

// Covers the soft-delete extension's read filter AND the legacy-user
// cleanup script's idempotent archival. Runs against the real local DB
// — e2e-style, no mocks — because the extension intercepts Prisma at a
// layer that's not meaningfully exercised by mocks.

async function makeLegacyTestUser(): Promise<string> {
  // Matches the Step-18 "pre-wizard ghost" shape: no address, unverified
  // EMAIL identifier.
  const email = `legacy-${crypto.randomUUID()}@kolaleaf.test`
  const user = await testDb.user.create({
    data: {
      fullName: 'Legacy Ghost',
      passwordHash: 'x',
      identifiers: { create: { type: 'EMAIL', identifier: email, verified: false } },
    },
  })
  return user.id
}

describe('User.deletedAt soft-delete extension', () => {
  let userId: string

  beforeEach(async () => {
    userId = await makeLegacyTestUser()
  })

  it('findUnique returns a live user', async () => {
    const u = await softDeletePrisma.user.findUnique({ where: { id: userId } })
    expect(u).not.toBeNull()
    expect(u?.id).toBe(userId)
  })

  it('findUnique returns null for a soft-deleted user', async () => {
    await testDb.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
    const u = await softDeletePrisma.user.findUnique({ where: { id: userId } })
    expect(u).toBeNull()
  })

  it('findMany omits soft-deleted users from the default list', async () => {
    await testDb.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
    const all = await softDeletePrisma.user.findMany({ where: { id: userId } })
    expect(all).toHaveLength(0)
  })

  it('explicit deletedAt in where clause bypasses the filter', async () => {
    await testDb.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
    const archived = await softDeletePrisma.user.findMany({
      where: { id: userId, deletedAt: { not: null } },
    })
    expect(archived).toHaveLength(1)
  })

  it('count excludes soft-deleted users by default', async () => {
    const before = await softDeletePrisma.user.count({ where: { id: userId } })
    expect(before).toBe(1)
    await testDb.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
    const after = await softDeletePrisma.user.count({ where: { id: userId } })
    expect(after).toBe(0)
  })
})

describe('cleanupLegacyUsers script', () => {
  let userId: string

  beforeEach(async () => {
    userId = await makeLegacyTestUser()
  })

  it('dry-run reports the candidate but does not mutate', async () => {
    const result = await cleanupLegacyUsers({ apply: false })
    expect(result.examined).toBeGreaterThanOrEqual(1)
    const u = await testDb.user.findUnique({ where: { id: userId } })
    expect(u?.deletedAt).toBeNull()
  })

  it('apply flips deletedAt for a qualifying row', async () => {
    await cleanupLegacyUsers({ apply: true })
    const u = await testDb.user.findUnique({ where: { id: userId } })
    expect(u?.deletedAt).not.toBeNull()
  })

  it('is idempotent: second apply is a no-op for already-archived rows', async () => {
    await cleanupLegacyUsers({ apply: true })
    const second = await cleanupLegacyUsers({ apply: true })
    expect(second.skippedAlreadyArchived).toBeGreaterThanOrEqual(1)
  })
})
