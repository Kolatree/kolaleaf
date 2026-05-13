'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'
import { AuthShell } from '@/components/design/AuthShell'
import {
  GRADIENT,
  colors,
  radius,
  spacing,
  type as typeT,
} from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: spacing.ctaPad,
  borderRadius: radius.cta,
  fontSize: typeT.cta.size,
  fontWeight: typeT.cta.weight,
  letterSpacing: typeT.cta.letterSpacing,
}

function MockKycInner() {
  const params = useSearchParams()
  const router = useRouter()
  const applicantId = params.get('applicantId') ?? 'mock-applicant'
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')

  async function complete(outcome: 'approve' | 'reject') {
    setLoading(outcome)
    setError('')

    try {
      const res = await apiFetch('kyc/mock/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(String(data.error ?? 'Unable to complete mock verification'))
        return
      }

      router.push(outcome === 'approve' ? '/send' : '/account')
      router.refresh()
    } catch {
      setError('Unable to complete mock verification')
    } finally {
      setLoading(null)
    }
  }

  return (
    <AuthShell fullScreen>
      <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
        Mock identity verification
      </h2>
      <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
        Local dev is running without Sumsub credentials, so this page stands in for the hosted
        verification flow.
      </p>

      <div
        style={{
          marginTop: 18,
          background: '#f7f7fb',
          borderRadius: 12,
          padding: '14px 16px',
          fontSize: '13px',
          color: colors.ink,
        }}
      >
        Applicant ID: <strong>{applicantId}</strong>
      </div>

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

      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => complete('approve')}
          disabled={loading !== null}
          style={{
            ...buttonStyle,
            background: GRADIENT,
            color: '#fff',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading === 'approve' ? 'Approving…' : 'Approve verification'}
        </button>

        <button
          type="button"
          onClick={() => complete('reject')}
          disabled={loading !== null}
          style={{
            ...buttonStyle,
            background: '#fff4e5',
            color: '#9a3412',
            border: '1px solid #fed7aa',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading === 'reject' ? 'Rejecting…' : 'Simulate rejection'}
        </button>
      </div>
    </AuthShell>
  )
}

export default function MockKycPage() {
  return (
    <Suspense fallback={<div style={{ color: '#fff' }}>Loading…</div>}>
      <MockKycInner />
    </Suspense>
  )
}
