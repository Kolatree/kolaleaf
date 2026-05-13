export interface KycAction {
  endpoint: 'kyc/initiate' | 'kyc/retry'
  label: string
}

export function getKycAction(status: string | null | undefined): KycAction | null {
  switch (status) {
    case 'PENDING':
      return { endpoint: 'kyc/initiate', label: 'Start verification →' }
    case 'REJECTED':
      return { endpoint: 'kyc/retry', label: 'Retry verification →' }
    default:
      return null
  }
}

export function isAllowedSumsubUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  const sameOrigin =
    typeof window !== 'undefined' && url.origin === window.location.origin

  if (
    process.env.NODE_ENV !== 'production' &&
    sameOrigin &&
    url.pathname.startsWith('/kyc/mock')
  ) {
    return true
  }

  if (url.protocol !== 'https:') return false
  return url.host === 'sumsub.com' || url.host.endsWith('.sumsub.com')
}
