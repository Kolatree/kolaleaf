import { prisma } from '@/lib/db/client'
import type { Referral } from '../../generated/prisma/client'
import type { Decimal } from 'decimal.js'

export async function getReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  })
  return user.referralCode
}

interface ReferralStats {
  totalReferred: number
  completedTransfers: number
  pendingRewards: number
  paidRewards: number
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const referrals = await prisma.referral.findMany({
    where: { referrerId: userId },
    select: { rewardStatus: true },
  })

  const totalReferred = referrals.length
  // ELIGIBLE means the referred user completed their first transfer
  const completedTransfers = referrals.filter(
    (r) => r.rewardStatus === 'ELIGIBLE' || r.rewardStatus === 'PAID'
  ).length
  const pendingRewards = referrals.filter(
    (r) => r.rewardStatus === 'ELIGIBLE'
  ).length
  const paidRewards = referrals.filter(
    (r) => r.rewardStatus === 'PAID'
  ).length

  return { totalReferred, completedTransfers, pendingRewards, paidRewards }
}

export async function checkAndTriggerReward(
  transferId: string
): Promise<Referral | null> {
  const transfer = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    select: { userId: true },
  })

  // Find the referral for this transfer's user
  const referral = await prisma.referral.findUnique({
    where: { referredUserId: transfer.userId },
  })

  // No referral exists for this user
  if (!referral) {
    return null
  }

  // Only trigger on PENDING — if already ELIGIBLE, PAID, or EXPIRED, skip
  if (referral.rewardStatus !== 'PENDING') {
    return null
  }

  // Transition to ELIGIBLE and record the triggering transfer
  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: {
      rewardStatus: 'ELIGIBLE',
      completedTransferId: transferId,
    },
  })

  return updated
}

export async function processReward(
  referralId: string,
  amount: Decimal
): Promise<Referral> {
  const referral = await prisma.referral.findUniqueOrThrow({
    where: { id: referralId },
  })

  if (referral.rewardStatus !== 'ELIGIBLE') {
    throw new Error('Referral is not eligible for reward')
  }

  return prisma.referral.update({
    where: { id: referralId },
    data: {
      rewardStatus: 'PAID',
      rewardAmount: amount.toNumber(),
    },
  })
}

export async function listReferrals(userId: string): Promise<Referral[]> {
  return prisma.referral.findMany({
    where: { referrerId: userId },
    orderBy: { createdAt: 'desc' },
  })
}
