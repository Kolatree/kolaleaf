'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  KolaLogo,
  Tagline,
  FieldLabel,
  colors,
  radius,
  shadow,
  spacing,
  type as typeT,
  GRADIENT,
} from '@/components/design/KolaPrimitives'

function codeInputStyle() {
  return {
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '24px',
    letterSpacing: '0.5em',
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    textAlign: 'center' as const,
    outline: 'none',
  }
}

function VerifyEmailInner() {
  const router = useRouter()
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Verification failed')
        return
      }

      router.push('/send')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setInfo('')
    setResending(true)
    try {
      // Endpoint always returns 200 — see route preamble. We surface a
      // friendly "sent" message either way; if the email isn't actually on
      // file the user just doesn't get a code.
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setInfo('If this email is on file, a new code is on its way.')
    } catch {
      setError('Could not request a new code.')
    } finally {
      setResending(false)
    }
  }

  // Without an email param the page can't help. Send the user back to login.
  if (!email) {
    return (
      <div className="w-full max-w-sm kola-card-enter text-center" style={{ color: colors.cardBg }}>
        <p style={{ marginBottom: 12 }}>Verification link is missing your email.</p>
        <Link href="/login" style={{ color: colors.cardBg, textDecoration: 'underline' }}>
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm kola-card-enter">
      <div className="text-center mb-8">
        <KolaLogo tone="onDark" size="lg" />
        <div className="mt-2"><Tagline tone="onDark" /></div>
      </div>

      <div
        style={{
          background: colors.cardBg,
          borderRadius: radius.card,
          padding: spacing.cardPad,
          boxShadow: shadow.card,
          color: colors.ink,
        }}
      >
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>
            Verify your email
          </h2>
          <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
            We sent a 6-digit code to <strong>{email}</strong>. Enter it below to finish creating
            your account.
          </p>

          {error && (
            <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
              {error}
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
              style={codeInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            aria-busy={loading}
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
            {loading ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>

        <p className="text-center mt-5" style={{ fontSize: '13px', color: colors.muted }}>
          Didn&apos;t get a code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            style={{
              color: colors.purple,
              fontWeight: 600,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: resending ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
            }}
          >
            {resending ? 'Sending…' : 'Send a new one'}
          </button>
        </p>

        <p className="text-center mt-2" style={{ fontSize: '12px', color: colors.muted }}>
          <Link href="/login" style={{ color: colors.muted }}>
            Back to sign in
          </Link>
        </p>
      </div>

      <div className="mt-6 flex items-center justify-center gap-5 text-white/80" style={{ fontSize: '11px' }}>
        <span>🔒 AUSTRAC</span>
        <span>⚡ Minutes</span>
        <span>★ 4.8/5</span>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div style={{ color: '#fff' }}>Loading…</div>}>
      <VerifyEmailInner />
    </Suspense>
  )
}
