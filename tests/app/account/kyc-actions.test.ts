import { describe, expect, it } from 'vitest'
import { getKycAction, isAllowedSumsubUrl } from '@/app/(dashboard)/account/kyc-actions'

describe('account KYC helpers', () => {
  it('routes pending users to kyc/initiate', () => {
    expect(getKycAction('PENDING')).toEqual({
      endpoint: 'kyc/initiate',
      label: 'Start verification →',
    })
  })

  it('routes rejected users to kyc/retry', () => {
    expect(getKycAction('REJECTED')).toEqual({
      endpoint: 'kyc/retry',
      label: 'Retry verification →',
    })
  })

  it('returns no action for non-actionable statuses', () => {
    expect(getKycAction('VERIFIED')).toBeNull()
    expect(getKycAction('IN_REVIEW')).toBeNull()
    expect(getKycAction(null)).toBeNull()
  })

  it('allows only https Sumsub URLs', () => {
    expect(isAllowedSumsubUrl('https://sumsub.com/verify/mock')).toBe(true)
    expect(isAllowedSumsubUrl('https://app.sumsub.com/start')).toBe(true)
    expect(isAllowedSumsubUrl('http://sumsub.com/verify/mock')).toBe(false)
    expect(isAllowedSumsubUrl('https://evil.com/verify/mock')).toBe(false)
    expect(isAllowedSumsubUrl('not-a-url')).toBe(false)
  })
})
