import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { registerUser } from '../register'

beforeEach(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'RegisterTest' } } })
})

afterAll(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'RegisterTest' } } })
})

describe('registration service', () => {
  it('creates a user with PENDING kyc status', async () => {
    const { user } = await registerUser({
      fullName: 'RegisterTest One',
      email: 'reg1@example.com',
      password: 'StrongPass1!',
    })
    expect(user.kycStatus).toBe('PENDING')
    expect(user.fullName).toBe('RegisterTest One')
  })

  it('creates an email identifier for the user', async () => {
    const { user } = await registerUser({
      fullName: 'RegisterTest Two',
      email: 'reg2@example.com',
      password: 'StrongPass2!',
    })
    const identifiers = await prisma.userIdentifier.findMany({
      where: { userId: user.id },
    })
    expect(identifiers).toHaveLength(1)
    expect(identifiers[0].type).toBe('EMAIL')
    expect(identifiers[0].identifier).toBe('reg2@example.com')
    // Step 15d: new users start unverified. The verification email flips this
    // via /api/auth/verify-email on first click.
    expect(identifiers[0].verified).toBe(false)
    expect(identifiers[0].verifiedAt).toBeNull()
  })

  it('creates a session upon registration', async () => {
    const { session } = await registerUser({
      fullName: 'RegisterTest Three',
      email: 'reg3@example.com',
      password: 'StrongPass3!',
    })
    expect(session.token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('links referral when referral code provided', async () => {
    // Create the referrer first
    const referrer = await prisma.user.create({
      data: { fullName: 'RegisterTest Referrer' },
    })
    const { user } = await registerUser({
      fullName: 'RegisterTest Referred',
      email: 'referred@example.com',
      password: 'StrongPass4!',
      referralCode: referrer.referralCode,
    })
    const referral = await prisma.referral.findUnique({
      where: { referredUserId: user.id },
    })
    expect(referral).not.toBeNull()
    expect(referral!.referrerId).toBe(referrer.id)
  })

  it('throws on duplicate email', async () => {
    await registerUser({
      fullName: 'RegisterTest Dup1',
      email: 'dup@register.com',
      password: 'StrongPass5!',
    })
    await expect(
      registerUser({
        fullName: 'RegisterTest Dup2',
        email: 'dup@register.com',
        password: 'StrongPass6!',
      })
    ).rejects.toThrow()
  })
})
