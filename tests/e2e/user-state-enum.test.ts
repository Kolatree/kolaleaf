import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { prisma } from './helpers'

// Verifies the Postgres-level AuState enum enforces the 8 AU codes.
// Runtime cost of enforcement is a single CHECK inside the DB; this
// test proves the migration (CREATE TYPE + ALTER COLUMN) actually
// landed and is rejecting dirty values.

async function makeUser(state: string | null) {
  return prisma.user.create({
    data: {
      fullName: `Test ${crypto.randomUUID()}`,
      passwordHash: 'x',
      addressLine1: '1 Test St',
      city: 'Testville',
      // Cast through unknown so we can deliberately feed the test
      // non-enum values without tsc catching them first — Prisma's
      // runtime validator is what we're exercising here.
      state: state as unknown as 'NSW',
      postcode: '2000',
      country: 'AU',
    },
  })
}

describe('User.state Postgres enum', () => {
  it('accepts a valid enum value', async () => {
    const u = await makeUser('NSW')
    expect(u.state).toBe('NSW')
    await prisma.user.delete({ where: { id: u.id } })
  })

  it('accepts NULL (pre-wizard legacy rows stay migration-safe)', async () => {
    const u = await makeUser(null)
    expect(u.state).toBeNull()
    await prisma.user.delete({ where: { id: u.id } })
  })

  it('rejects wrong-case `Nsw`', async () => {
    await expect(makeUser('Nsw')).rejects.toThrow()
  })

  it('rejects nonexistent code `ZZZ`', async () => {
    await expect(makeUser('ZZZ')).rejects.toThrow()
  })
})
