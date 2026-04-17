'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FieldLabel,
  colors,
  radius,
  spacing,
  type as typeT,
  GRADIENT,
  codeInputStyle,
} from '@/components/design/KolaPrimitives'
import { AuthShell } from '@/components/design/AuthShell'
import { useWizardSubmit } from '@/lib/hooks/use-wizard-submit'

// Step 2 of the verify-first wizard: enter the 6-digit code, open the
// 30-minute claim window, proceed to step 3. Never issues a session.
function RegisterVerifyInner() {
  const router = useRouter()
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [code, setCode] = useState('')
  const [info, setInfo] = useState('')
  const verify = useWizardSubmit()
  const resend = useWizardSubmit()

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setInfo('')
    await verify.submit({
      endpoint: '/api/auth/verify-code',
      body: { email, code },
      onOk: () => router.push(`/register/details?email=${encodeURIComponent(email)}`),
      onFail: (data) => {
        // Reason-driven recovery routing.
        if (data.reason === 'no_token' || data.reason === 'used') {
          router.push('/register')
          return null
        }
        if (data.reason === 'expired' || data.reason === 'too_many_attempts') {
          return (
            (data.error || 'Verification failed') +
            ' Tap "Send a new one" below to continue.'
          )
        }
      },
    })
  }

  async function handleResend() {
    setInfo('')
    // /send-code is always 200. Show the friendly confirmation regardless
    // of whether a code was actually dispatched.
    await resend.submit({
      endpoint: '/api/auth/send-code',
      body: { email },
      onOk: () => setInfo('If this email is on file, a new code is on its way.'),
    })
  }

  if (!email) {
    return (
      <div className="w-full max-w-sm kola-card-enter text-center" style={{ color: colors.cardBg }}>
        <p style={{ marginBottom: 12 }}>We lost track of your email. Please start over.</p>
        <Link href="/register" style={{ color: colors.cardBg, textDecoration: 'underline' }}>
          Back to register
        </Link>
      </div>
    )
  }

  return (
    <AuthShell>
      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>Verify your email</h2>
        <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
        </p>

        {verify.error && (
          <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
            {verify.error}
          </div>
        )}
        {info && (
          <div role="status" style={{ background: '#eef9f0', color: '#1a6e3a', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
            {info}
          </div>
        )}

        <label className="flex flex-col gap-2">
          <FieldLabel>6-digit code</FieldLabel>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            style={codeInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
            onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={verify.loading || code.length !== 6}
          aria-busy={verify.loading}
          className="w-full text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: GRADIENT,
            padding: spacing.ctaPad,
            borderRadius: radius.cta,
            fontSize: typeT.cta.size,
            fontWeight: typeT.cta.weight,
            letterSpacing: typeT.cta.letterSpacing,
            marginTop: '4px',
          }}
        >
          {verify.loading ? 'Verifying…' : 'Verify and continue'}
        </button>
      </form>

      <p className="text-center mt-5" style={{ fontSize: '13px', color: colors.muted }}>
        Didn&apos;t get a code?{' '}
        <button
          type="button"
          onClick={handleResend}
          disabled={resend.loading}
          style={{
            color: colors.purple,
            fontWeight: 600,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: resend.loading ? 'not-allowed' : 'pointer',
            textDecoration: 'underline',
          }}
        >
          {resend.loading ? 'Sending…' : 'Send a new one'}
        </button>
      </p>

      <p className="text-center mt-2" style={{ fontSize: '12px', color: colors.muted }}>
        <Link href="/login" style={{ color: colors.muted }}>
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  )
}

export default function RegisterVerifyPage() {
  return (
    <Suspense fallback={<div style={{ color: '#fff' }}>Loading…</div>}>
      <RegisterVerifyInner />
    </Suspense>
  )
}
