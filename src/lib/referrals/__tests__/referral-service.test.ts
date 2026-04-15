import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { Decimal } from 'decimal.js'
import {
  getReferralCode,
  getReferralStats,
  checkAndTriggerReward,
  processReward,
  listReferrals,
} from '../referral-service'

const TEST_PREFIX = 'RefSvcTest'

// Helper: create a user, a corridor, a recipient, and a transfer for that user
async function createTransferForUser(
  userId: string,
  status: string
) {
  // Ensure corridor exists (reuse if already created)
  let corridor = await prisma.corridor.findUnique({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
  })
  if (!corridor) {
    corridor = await prisma.corridor.create({
      data: {
        baseCurrency: 'AUD',
        targetCurrency: 'NGN',
        minAmount: 10,
        maxAmount: 50000,
      },
    })
  }

  let recipient = await prisma.recipient.findFirst({ where: { userId } })
  if (!recipient) {
    recipient = await prisma.recipient.create({
      data: {
        userId,
        fullName: 'Test Recipient',
        bankName: 'Test Bank',
        bankCode: '000',
        accountNumber: '1234567890',
      },
    })
  }

  const transfer = await prisma.transfer.create({
    data: {
      userId,
      recipientId: recipient.id,
      corridorId: corridor.id,
      sendAmount: 100,
      receiveAmount: 50000,
      exchangeRate: 500,
      status: status as 'COMPLETED',
    },
  })
  return transfer
}

async function cleanup() {
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
  await prisma.recipient.deleteMany({})
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: TEST_PREFIX } } })
  // Do NOT delete corridors or rates — those are seeded data shared with other test
  // files. This test reuses the seeded AUD-NGN corridor via findUnique-or-create
  // (see createTransferForUser above), so wiping them breaks every subsequent
  // test file that depends on the seed.
}

beforeEach(cleanup)
afterAll(cleanup)

describe('getReferralCode', () => {
  it('returns the user referral code', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} CodeUser` },
    })

    const code = await getReferralCode(user.id)

    expect(code).toBe(user.referralCode)
    expect(typeof code).toBe('string')
    expect(code.length).toBeGreaterThan(0)
  })
})

describe('getReferralStats', () => {
  it('returns correct counts for a user with referrals', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} StatsReferrer` },
    })

    // Create 3 referred users with different reward statuses
    const pending = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} Pending` } })
    const eligible = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} Eligible` } })
    const paid = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} Paid` } })

    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: pending.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'PENDING',
      },
    })
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: eligible.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'ELIGIBLE',
      },
    })
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: paid.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'PAID',
        rewardAmount: 25,
      },
    })

    const stats = await getReferralStats(referrer.id)

    expect(stats.totalReferred).toBe(3)
    expect(stats.completedTransfers).toBe(2)  // ELIGIBLE + PAID both had a completed transfer
    expect(stats.pendingRewards).toBe(1)
    expect(stats.paidRewards).toBe(1)
  })

  it('returns zeros for a user with no referrals', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NoRefs` },
    })

    const stats = await getReferralStats(user.id)

    expect(stats.totalReferred).toBe(0)
    expect(stats.completedTransfers).toBe(0)
    expect(stats.pendingRewards).toBe(0)
    expect(stats.paidRewards).toBe(0)
  })
})

describe('checkAndTriggerReward', () => {
  it('transitions referral to ELIGIBLE on first completed transfer', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} TriggerReferrer` },
    })
    const referred = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} TriggerReferred` },
    })

    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: referred.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'PENDING',
      },
    })

    const transfer = await createTransferForUser(referred.id, 'COMPLETED')

    const result = await checkAndTriggerReward(transfer.id)

    expect(result).not.toBeNull()
    expect(result!.rewardStatus).toBe('ELIGIBLE')
    expect(result!.completedTransferId).toBe(transfer.id)
  })

  it('does not re-trigger on second completed transfer', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NoReTriggerReferrer` },
    })
    const referred = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NoReTriggerReferred` },
    })

    const firstTransfer = await createTransferForUser(referred.id, 'COMPLETED')

    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: referred.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'ELIGIBLE',
        completedTransferId: firstTransfer.id,
      },
    })

    const secondTransfer = await createTransferForUser(referred.id, 'COMPLETED')

    const result = await checkAndTriggerReward(secondTransfer.id)

    expect(result).toBeNull()
  })

  it('returns null when the transfer user has no referral', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NoRefUser` },
    })

    const transfer = await createTransferForUser(user.id, 'COMPLETED')

    const result = await checkAndTriggerReward(transfer.id)

    expect(result).toBeNull()
  })
})

describe('processReward', () => {
  it('transitions referral from ELIGIBLE to PAID with amount', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} PayReferrer` },
    })
    const referred = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} PayReferred` },
    })

    const referral = await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: referred.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'ELIGIBLE',
      },
    })

    const result = await processReward(referral.id, new Decimal(25))

    expect(result.rewardStatus).toBe('PAID')
    expect(new Decimal(result.rewardAmount!.toString()).equals(new Decimal(25))).toBe(true)
  })

  it('throws when referral is not ELIGIBLE', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} BadPayReferrer` },
    })
    const referred = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} BadPayReferred` },
    })

    const referral = await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: referred.id,
        referralCode: referrer.referralCode,
        rewardStatus: 'PENDING',
      },
    })

    await expect(processReward(referral.id, new Decimal(25))).rejects.toThrow(
      'Referral is not eligible for reward'
    )
  })
})

describe('listReferrals', () => {
  it('returns all referrals made by a user', async () => {
    const referrer = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} ListReferrer` },
    })
    const r1 = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} ListR1` } })
    const r2 = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} ListR2` } })

    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: r1.id,
        referralCode: referrer.referralCode,
      },
    })
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredUserId: r2.id,
        referralCode: referrer.referralCode,
      },
    })

    const referrals = await listReferrals(referrer.id)

    expect(referrals).toHaveLength(2)
    expect(referrals.map((r) => r.referredUserId).sort()).toEqual(
      [r1.id, r2.id].sort()
    )
  })

  it('returns empty array when user has no referrals', async () => {
    const user = await prisma.user.create({
      data: { fullName: `${TEST_PREFIX} NoListRefs` },
    })

    const referrals = await listReferrals(user.id)

    expect(referrals).toHaveLength(0)
  })
})
