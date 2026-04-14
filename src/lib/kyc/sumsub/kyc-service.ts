import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '@/lib/auth/audit'
import type { SumsubClient } from './client.js'
import type { KycStatus } from '@/generated/prisma/client'

interface InitiateKycResult {
  applicantId: string
  accessToken: string
  verificationUrl: string
}

interface KycStatusResult {
  status: KycStatus
  applicantId?: string
}

interface RetryKycResult {
  accessToken: string
  verificationUrl: string
}

export async function initiateKyc(userId: string, client: SumsubClient): Promise<InitiateKycResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { identifiers: true },
  })

  if (user.kycStatus === 'VERIFIED') {
    throw new Error('KYC already verified')
  }

  if (user.kycStatus === 'IN_REVIEW') {
    throw new Error('KYC already in review')
  }

  const emailIdentifier = user.identifiers.find((i) => i.type === 'EMAIL')
  const email = emailIdentifier?.identifier ?? ''

  const { applicantId } = await client.createApplicant({
    userId: user.id,
    email,
    fullName: user.fullName,
  })

  const { token, url } = await client.getAccessToken(applicantId)

  await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: 'IN_REVIEW',
      kycProviderId: applicantId,
    },
  })

  await logAuthEvent({
    userId,
    event: 'kyc.initiated',
    metadata: { applicantId },
  })

  return {
    applicantId,
    accessToken: token,
    verificationUrl: url,
  }
}

export async function handleKycApproved(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED' },
  })

  await logAuthEvent({
    userId,
    event: 'kyc.approved',
  })

  return user
}

export async function handleKycRejected(userId: string, reasons: string[]) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: 'REJECTED',
      kycRejectionReasons: reasons,
    },
  })

  await logAuthEvent({
    userId,
    event: 'kyc.rejected',
    metadata: { reasons },
  })

  return user
}

export async function getKycStatus(userId: string): Promise<KycStatusResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  })

  return {
    status: user.kycStatus,
    applicantId: user.kycProviderId ?? undefined,
  }
}

export async function retryKyc(userId: string, client: SumsubClient): Promise<RetryKycResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  })

  if (user.kycStatus !== 'REJECTED') {
    throw new Error('KYC retry only available for rejected applications')
  }

  if (!user.kycProviderId) {
    throw new Error('No existing KYC application to retry')
  }

  const { token, url } = await client.getAccessToken(user.kycProviderId)

  await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: 'IN_REVIEW',
      kycRejectionReasons: [],
    },
  })

  await logAuthEvent({
    userId,
    event: 'kyc.retry',
    metadata: { applicantId: user.kycProviderId },
  })

  return {
    accessToken: token,
    verificationUrl: url,
  }
}
