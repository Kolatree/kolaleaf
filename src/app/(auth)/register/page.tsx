'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

// Step 1 of the verify-first wizard: capture only the email, request a
// 6-digit code, and bounce to /register/verify. The account does NOT
// exist yet; a PendingEmailVerification row is the only side effect.
function textInputStyle() {
  return {
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
    outline: 'none',
  } as const
}

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not send verification code')
        return
      }

      // /send-code is enumeration-proof: always 200. We unconditionally
      // move the user to step 2 with the email in the URL.
      router.push(`/register/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
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
        <form onSubmit={handleSendCode} className="flex flex-col gap-4">
          <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>Create account</h2>
          <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
            We&apos;ll email you a 6-digit code to verify your address. No account is created until you finish the next two steps.
          </p>

          {error && (
            <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
              {error}
            </div>
          )}

          <label className="flex flex-col gap-2">
            <FieldLabel>Email</FieldLabel>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>

          <button
            type="submit"
            disabled={loading || email.trim().length === 0}
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
            {loading ? 'Sending code…' : 'Send code'}
          </button>
        </form>

        <p className="text-center mt-5" style={{ fontSize: '13px', color: colors.muted }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: colors.purple, fontWeight: 600 }}>
            Sign in
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
