import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import Decimal from 'decimal.js'
import crypto from 'crypto'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
export const prisma = new PrismaClient({ adapter })

let corridorId: string

export async function getTestCorridorId(): Promise<string> {
  if (corridorId) return corridorId
  const corridor = await prisma.corridor.findUniqueOrThrow({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
  })
  corridorId = corridor.id
  return corridorId
}

export async function getTestCorridor() {
  const id = await getTestCorridorId()
  return prisma.corridor.findUniqueOrThrow({ where: { id } })
}

/**
 * Register a user with an email identifier and session, returning all pieces.
 */
export async function registerTestUser(overrides: {
  email?: string
  password?: string
  fullName?: string
  kycStatus?: 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED'
  dailyLimit?: number
  isAdmin?: boolean
} = {}) {
  const email = overrides.email ?? `test-${crypto.randomUUID()}@kolaleaf.test`
  const bcrypt = await import('bcrypt')
  const passwordHash = await bcrypt.hash(overrides.password ?? 'TestPassword123!', 12)

  const user = await prisma.user.create({
    data: {
      fullName: overrides.fullName ?? 'Test User',
      passwordHash,
      kycStatus: overrides.kycStatus ?? 'PENDING',
      dailyLimit: overrides.dailyLimit ?? 10000,
      identifiers: {
        create: {
          type: 'EMAIL',
          identifier: email,
          verified: true,
          verifiedAt: new Date(),
        },
      },
    },
    include: { identifiers: true },
  })

  // Create a valid session
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  const session = await prisma.session.create({
    data: { userId: user.id, token, expiresAt },
  })

  return { user, email, session, token }
}

/**
 * Create a recipient belonging to the given user.
 */
export async function createTestRecipient(userId: string, overrides: {
  fullName?: string
  bankCode?: string
  accountNumber?: string
} = {}) {
  return prisma.recipient.create({
    data: {
      userId,
      fullName: overrides.fullName ?? 'Test Recipient',
      bankName: 'GTBank',
      bankCode: overrides.bankCode ?? '058',
      accountNumber: overrides.accountNumber ?? '0123456789',
    },
  })
}

/**
 * Create a transfer at a given status, with supporting audit event.
 */
export async function createTestTransfer(
  userId: string,
  recipientId: string,
  overrides: {
    status?: string
    sendAmount?: number
    retryCount?: number
    payidReference?: string
    payoutProvider?: 'FLUTTERWAVE' | 'BUDPAY'
    payoutProviderRef?: string
  } = {}
) {
  const cId = await getTestCorridorId()
  const transfer = await prisma.transfer.create({
    data: {
      userId,
      recipientId,
      corridorId: cId,
      sendAmount: overrides.sendAmount ?? 500,
      receiveAmount: new Decimal(overrides.sendAmount ?? 500).mul(1042.65),
      exchangeRate: 1042.65,
      fee: 5,
      status: (overrides.status as any) ?? 'CREATED',
      retryCount: overrides.retryCount ?? 0,
      payidReference: overrides.payidReference,
      payoutProvider: overrides.payoutProvider as any,
      payoutProviderRef: overrides.payoutProviderRef,
    },
  })

  await prisma.transferEvent.create({
    data: {
      transferId: transfer.id,
      fromStatus: 'CREATED',
      toStatus: (overrides.status as any) ?? 'CREATED',
      actor: 'SYSTEM',
    },
  })

  return transfer
}

/**
 * Build a session cookie header string.
 */
export function sessionCookie(token: string): string {
  return `kolaleaf_session=${token}`
}

/**
 * Clean up all test data in correct FK order.
 */
export async function cleanupTestData() {
  await prisma.failedEmail.deleteMany({})
  await prisma.complianceReport.deleteMany({})
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
  await prisma.referral.deleteMany({})
  await prisma.recipient.deleteMany({})
  await prisma.emailVerificationToken.deleteMany({})
  await prisma.passwordResetToken.deleteMany({})
  await prisma.phoneVerificationCode.deleteMany({})
  await prisma.twoFactorChallenge.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.pendingEmailVerification.deleteMany({})
}

/**
 * Compute HMAC-SHA256 signature (Monoova/Sumsub style).
 */
export function hmacSha256(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Compute HMAC-SHA512 signature (Paystack style).
 */
export function hmacSha512(payload: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex')
}
