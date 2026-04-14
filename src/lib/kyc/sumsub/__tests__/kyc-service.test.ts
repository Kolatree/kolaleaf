import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initiateKyc,
  handleKycApproved,
  handleKycRejected,
  getKycStatus,
  retryKyc,
} from '../kyc-service'

vi.mock('../../../db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}))


vi.mock('../../../auth/audit', () => ({
  logAuthEvent: vi.fn(),
}))

import { prisma } from '../../../db/client'
import { logAuthEvent } from '../../../auth/audit'

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-001',
    fullName: 'Test User',
    kycStatus: 'PENDING',
    kycProviderId: null,
    kycRejectionReasons: [],
    identifiers: [{ type: 'EMAIL', identifier: 'test@example.com' }],
    ...overrides,
  }
}

describe('KYC Service', () => {
  const mockSumsubClient = {
    createApplicant: vi.fn(),
    getAccessToken: vi.fn(),
    getApplicantStatus: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initiateKyc', () => {
    it('creates a Sumsub applicant and transitions status to IN_REVIEW', async () => {
      const user = mockUser()
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      mockSumsubClient.createApplicant.mockResolvedValue({
        applicantId: 'applicant-abc-123',
      })
      mockSumsubClient.getAccessToken.mockResolvedValue({
        token: 'sdk-token-xyz',
        url: 'https://api.sumsub.com/idensic/#/applicant/applicant-abc-123',
      })

      vi.mocked(prisma.user.update).mockResolvedValue({
        ...user,
        kycStatus: 'IN_REVIEW',
        kycProviderId: 'applicant-abc-123',
      } as any)

      const result = await initiateKyc('user-001', mockSumsubClient)

      expect(result.applicantId).toBe('applicant-abc-123')
      expect(result.accessToken).toBe('sdk-token-xyz')
      expect(result.verificationUrl).toContain('applicant-abc-123')

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-001' },
        data: {
          kycStatus: 'IN_REVIEW',
          kycProviderId: 'applicant-abc-123',
        },
      })

      expect(logAuthEvent).toHaveBeenCalledWith({
        userId: 'user-001',
        event: 'kyc.initiated',
        metadata: { applicantId: 'applicant-abc-123' },
      })
    })

    it('throws when user is already VERIFIED', async () => {
      const user = mockUser({ kycStatus: 'VERIFIED' })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      await expect(initiateKyc('user-001')).rejects.toThrow(
        'KYC already verified'
      )

      expect(mockSumsubClient.createApplicant).not.toHaveBeenCalled()
    })

    it('throws when user is already IN_REVIEW', async () => {
      const user = mockUser({ kycStatus: 'IN_REVIEW' })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      await expect(initiateKyc('user-001')).rejects.toThrow(
        'KYC already in review'
      )
    })
  })

  describe('handleKycApproved', () => {
    it('updates KYC status to VERIFIED and logs auth event', async () => {
      const updated = mockUser({ kycStatus: 'VERIFIED' })
      vi.mocked(prisma.user.update).mockResolvedValue(updated as any)

      const result = await handleKycApproved('user-001')

      expect(result.kycStatus).toBe('VERIFIED')
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-001' },
        data: { kycStatus: 'VERIFIED' },
      })

      expect(logAuthEvent).toHaveBeenCalledWith({
        userId: 'user-001',
        event: 'kyc.approved',
      })
    })
  })

  describe('handleKycRejected', () => {
    it('updates KYC status to REJECTED with reasons and logs auth event', async () => {
      const reasons = ['ID_INVALID', 'SELFIE_MISMATCH']
      const updated = mockUser({
        kycStatus: 'REJECTED',
        kycRejectionReasons: reasons,
      })
      vi.mocked(prisma.user.update).mockResolvedValue(updated as any)

      const result = await handleKycRejected('user-001', reasons)

      expect(result.kycStatus).toBe('REJECTED')
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-001' },
        data: {
          kycStatus: 'REJECTED',
          kycRejectionReasons: reasons,
        },
      })

      expect(logAuthEvent).toHaveBeenCalledWith({
        userId: 'user-001',
        event: 'kyc.rejected',
        metadata: { reasons },
      })
    })
  })

  describe('getKycStatus', () => {
    it('returns current KYC status and applicantId', async () => {
      const user = mockUser({
        kycStatus: 'IN_REVIEW',
        kycProviderId: 'applicant-abc-123',
      })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      const result = await getKycStatus('user-001')

      expect(result.status).toBe('IN_REVIEW')
      expect(result.applicantId).toBe('applicant-abc-123')
    })

    it('returns PENDING status without applicantId', async () => {
      const user = mockUser()
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      const result = await getKycStatus('user-001')

      expect(result.status).toBe('PENDING')
      expect(result.applicantId).toBeUndefined()
    })
  })

  describe('retryKyc', () => {
    it('resets REJECTED user to IN_REVIEW and generates new access token', async () => {
      const user = mockUser({
        kycStatus: 'REJECTED',
        kycProviderId: 'applicant-abc-123',
      })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      mockSumsubClient.getAccessToken.mockResolvedValue({
        token: 'sdk-token-new',
        url: 'https://api.sumsub.com/idensic/#/applicant/applicant-abc-123',
      })

      vi.mocked(prisma.user.update).mockResolvedValue({
        ...user,
        kycStatus: 'IN_REVIEW',
      } as any)

      const result = await retryKyc('user-001', mockSumsubClient)

      expect(result.accessToken).toBe('sdk-token-new')
      expect(result.verificationUrl).toContain('applicant-abc-123')

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-001' },
        data: {
          kycStatus: 'IN_REVIEW',
          kycRejectionReasons: [],
        },
      })

      expect(logAuthEvent).toHaveBeenCalledWith({
        userId: 'user-001',
        event: 'kyc.retry',
        metadata: { applicantId: 'applicant-abc-123' },
      })
    })

    it('throws when user is not REJECTED', async () => {
      const user = mockUser({ kycStatus: 'PENDING' })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      await expect(retryKyc('user-001')).rejects.toThrow(
        'KYC retry only available for rejected applications'
      )
    })

    it('throws when user has no applicantId', async () => {
      const user = mockUser({
        kycStatus: 'REJECTED',
        kycProviderId: null,
      })
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(user as any)

      await expect(retryKyc('user-001')).rejects.toThrow(
        'No existing KYC application to retry'
      )
    })
  })
})
