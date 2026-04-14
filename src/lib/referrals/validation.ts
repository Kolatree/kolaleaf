import { prisma } from '@/lib/db/client'

export async function validateReferralCode(
  code: string
): Promise<{ valid: boolean; referrerId?: string }> {
  if (!code) {
    return { valid: false }
  }

  const user = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  })

  if (!user) {
    return { valid: false }
  }

  return { valid: true, referrerId: user.id }
}

export async function canUseReferralCode(
  userId: string,
  code: string
): Promise<boolean> {
  // Look up the referrer by code
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  })

  // Invalid code or self-referral
  if (!referrer || referrer.id === userId) {
    return false
  }

  // Check if user has already been referred
  const existingReferral = await prisma.referral.findUnique({
    where: { referredUserId: userId },
  })

  if (existingReferral) {
    return false
  }

  return true
}
