import { prisma } from '@/lib/db/client'
import { hashPassword } from './password'
import { logAuthEvent } from './audit'
import crypto from 'crypto'

interface RegisterParams {
  fullName: string
  email: string
  password: string
  referralCode?: string
}

export async function registerUser(params: RegisterParams) {
  const { fullName, email, password, referralCode } = params

  const passwordHash = await hashPassword(password)

  return prisma.$transaction(async (tx) => {
    // Check for existing email inside the transaction for consistency
    const existing = await tx.userIdentifier.findUnique({
      where: { identifier: email },
    })
    if (existing) {
      throw new Error('Email already registered')
    }

    const user = await tx.user.create({
      data: {
        fullName,
        passwordHash,
        identifiers: {
          create: {
            type: 'EMAIL',
            identifier: email,
            verified: true,
            verifiedAt: new Date(),
          },
        },
      },
    })

    // Handle referral
    if (referralCode) {
      const referrer = await tx.user.findUnique({
        where: { referralCode },
      })
      if (referrer) {
        await tx.referral.create({
          data: {
            referrerId: referrer.id,
            referredUserId: user.id,
            referralCode,
          },
        })
      }
    }

    // Create session
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const session = await tx.session.create({
      data: { userId: user.id, token, expiresAt },
    })

    // Audit log
    await tx.authEvent.create({
      data: {
        userId: user.id,
        event: 'REGISTER',
      },
    })

    return { user, session }
  })
}
