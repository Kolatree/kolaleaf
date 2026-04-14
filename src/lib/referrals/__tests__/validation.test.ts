import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { validateReferralCode, canUseReferralCode } from '../validation'

const TEST_PREFIX = 'RefValTest'

beforeEach(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: TEST_PREFIX } } })
})

afterAll(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: TEST_PREFIX } } })
})

describe('validateReferralCode', () => {
  it('returns valid=true and referrerId for a valid code', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} Referrer` },
    })

    const result = await validateReferralCode(user.referralCode)

    expect(result.valid).toBe(true)
    expect(result.referrerId).toBe(user.id)
  })

  it('returns valid=false for a nonexistent code', async () => {
    const result = await validateReferralCode('totally-fake-code-xyz')

    expect(result.valid).toBe(false)
    expect(result.referrerId).toBeUndefined()
  })

  it('returns valid=false for an empty string', async () => {
    const result = await validateReferralCode('')

    expect(result.valid).toBe(false)
    expect(result.referrerId).toBeUndefined()
  })
})

describe('canUseReferralCode', () => {
  it('blocks self-referral', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} Self` },
    })

    const result = await canUseReferralCode(user.id, user.referralCode)

    expect(result).toBe(false)
  })

  it('blocks already-referred users', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} Referrer2` },
    })
    const referred = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} Referred2` },
    })

    // Create an existing referral for this user
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: referred.id,
        referralCode: referrer.referralCode,
      },
    })

    // A different referrer tries to refer the same user
    const otherReferrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} OtherReferrer` },
    })

    const result = await canUseReferralCode(referred.id, otherReferrer.referralCode)

    expect(result).toBe(false)
  })

  it('allows a valid referral for an unreferred user', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} ValidReferrer` },
    })
    const newUser = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NewUser` },
    })

    const result = await canUseReferralCode(newUser.id, referrer.referralCode)

    expect(result).toBe(true)
  })
})
