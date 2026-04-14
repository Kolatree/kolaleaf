import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  addIdentifier,
  verifyIdentifier,
  findUserByIdentifier,
  getUserIdentifiers,
} from '../identity'

let testUserId: string

beforeEach(async () => {
  await prisma.userIdentifier.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'IdentityTest' } } })

  const user = await prisma.user.create({
    data: { fullName: 'IdentityTest User' },
  })
  testUserId = user.id
})

afterAll(async () => {
  await prisma.userIdentifier.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'IdentityTest' } } })
})

describe('identity service', () => {
  it('adds an email identifier to a user', async () => {
    const ident = await addIdentifier(testUserId, 'EMAIL', 'test@example.com')
    expect(ident.userId).toBe(testUserId)
    expect(ident.type).toBe('EMAIL')
    expect(ident.identifier).toBe('test@example.com')
    expect(ident.verified).toBe(false)
  })

  it('throws on duplicate identifier', async () => {
    await addIdentifier(testUserId, 'EMAIL', 'dup@example.com')
    await expect(
      addIdentifier(testUserId, 'EMAIL', 'dup@example.com')
    ).rejects.toThrow()
  })

  it('verifies an identifier', async () => {
    const ident = await addIdentifier(testUserId, 'EMAIL', 'verify@example.com')
    const verified = await verifyIdentifier(ident.id)
    expect(verified.verified).toBe(true)
    expect(verified.verifiedAt).toBeInstanceOf(Date)
  })

  it('finds a user by identifier', async () => {
    await addIdentifier(testUserId, 'PHONE', '+61400000000')
    const user = await findUserByIdentifier('+61400000000')
    expect(user).not.toBeNull()
    expect(user!.id).toBe(testUserId)
  })

  it('returns null for unknown identifier', async () => {
    const user = await findUserByIdentifier('nonexistent@example.com')
    expect(user).toBeNull()
  })

  it('lists all identifiers for a user', async () => {
    await addIdentifier(testUserId, 'EMAIL', 'a@example.com')
    await addIdentifier(testUserId, 'PHONE', '+61400000001')
    const identifiers = await getUserIdentifiers(testUserId)
    expect(identifiers).toHaveLength(2)
  })
})
