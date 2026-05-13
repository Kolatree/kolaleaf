'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  colors,
  radius,
  spacing,
  type as typeT,
  GRADIENT,
} from '@/components/design/KolaPrimitives'
import { AuthShell } from '@/components/design/AuthShell'
import { useWizardSubmit } from '@/lib/hooks/use-wizard-submit'
import { apiFetch } from '@/lib/http/api-client'
import { getKycAction, isAllowedSumsubUrl } from '../account/kyc-actions'
import { SumsubWebSdk } from './sumsub-websdk'

// Post-registration KYC prompt. Skippable at this stage — the hard
// block lives at transfer creation (KYC gates PayID per CLAUDE.md).

interface KycStatus {
  status: string
  applicantId?: string
}

interface StartKycResponse {
  applicantId?: string
  accessToken?: string
  verificationUrl?: string
}

export default function KycPage() {
  const router = useRouter()
  const { submit, error, loading, setError } = useWizardSubmit()
  const [kyc, setKyc] = useState<KycStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [accessToken, setAccessToken] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await apiFetch('kyc/status')
        if (!res.ok) return
        const data = (await res.json()) as KycStatus
        setKyc(data)
        if (data.status === 'VERIFIED') router.push('/send')
      } finally {
        setStatusLoading(false)
      }
    }

    loadStatus()
  }, [router])

  const handleSubmitted = useCallback(() => {
    setSubmitted(true)
  }, [])

  async function handleVerifyNow() {
    const endpoint =
      kyc?.status === 'IN_REVIEW'
        ? 'kyc/access-token'
        : getKycAction(kyc?.status)?.endpoint

    if (!endpoint) {
      setError('Verification is not available for your current account status.')
      return
    }

    await submit({
      endpoint,
      onOk: (data) => {
        const result = data as StartKycResponse
        if (isAllowedSumsubUrl(result.verificationUrl) && result.verificationUrl.includes('/kyc/mock')) {
          window.location.href = result.verificationUrl
          return
        }

        if (typeof result.accessToken === 'string' && result.accessToken.length > 0) {
          setAccessToken(result.accessToken)
          setKyc((current) => ({
            status: 'IN_REVIEW',
            applicantId: result.applicantId ?? current?.applicantId,
          }))
          return
        }

        if (isAllowedSumsubUrl(data.verificationUrl)) {
          window.location.href = data.verificationUrl as string
          return
        }

        setError('Verification could not be started. Please try again.')
      },
    })
  }

  return (
    <AuthShell fullScreen width={accessToken ? 'lg' : 'sm'}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
        Verify your identity
      </h2>
      <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
        Kolaleaf is an AUSTRAC-registered money transmitter. Before your first transfer we need
        to verify who you are. It takes about 2 minutes — a government ID and a quick selfie.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            background: '#fef1f2',
            color: '#b00020',
            fontSize: '13px',
            padding: '10px 12px',
            borderRadius: '8px',
            marginTop: 16,
          }}
        >
          {error}
        </div>
      )}

      {submitted && (
        <div
          role="status"
          style={{
            background: 'rgba(26,107,60,0.10)',
            color: colors.green,
            fontSize: '13px',
            padding: '10px 12px',
            borderRadius: '8px',
            marginTop: 16,
          }}
        >
          Verification submitted. We’ll unlock transfers once Sumsub confirms the result.
        </div>
      )}

      {accessToken ? (
        <div style={{ marginTop: 20 }}>
          <SumsubWebSdk accessToken={accessToken} onSubmitted={handleSubmitted} />
        </div>
      ) : (
        <button
          type="button"
          onClick={handleVerifyNow}
          disabled={loading || statusLoading}
          aria-busy={loading || statusLoading}
          className="w-full text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: GRADIENT,
            padding: spacing.ctaPad,
            borderRadius: radius.cta,
            fontSize: typeT.cta.size,
            fontWeight: typeT.cta.weight,
            letterSpacing: typeT.cta.letterSpacing,
            marginTop: 20,
          }}
        >
          {loading || statusLoading
            ? 'Starting…'
            : kyc?.status === 'IN_REVIEW'
              ? 'Continue verification'
              : 'Verify identity now'}
        </button>
      )}

      <p className="text-center mt-4" style={{ fontSize: '13px', color: colors.muted }}>
        <Link href="/send" style={{ color: colors.muted, textDecoration: 'underline' }}>
          Skip for now
        </Link>
      </p>
    </AuthShell>
  )
}
