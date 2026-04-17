'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KolaLogo, Tagline, FieldLabel, colors, radius, shadow, spacing, type as typeT, GRADIENT } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needs2FA, setNeeds2FA] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await apiFetch('auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: { type: 'email', value: email },
          password,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      // 202 with requiresVerification: backend already issued a fresh code.
      // Bounce to /verify-email so the user can enter it. Must run BEFORE
      // the 2FA branch — verification gates everything, including 2FA.
      if (data.requiresVerification && data.email) {
        router.push(`/verify-email?email=${encodeURIComponent(data.email)}`)
        return
      }

      if (data.requires2FA) {
        setNeeds2FA(true)
        return
      }

      router.push('/send')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handle2FA(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await apiFetch('auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: totpCode }),
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
        {!needs2FA ? (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>Sign in</h2>

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
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '14px',
                  outline: 'none',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
                onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
              />
            </label>

            <label className="flex flex-col gap-2">
              <FieldLabel>Password</FieldLabel>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="current-password"
                placeholder="At least 8 characters"
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '14px',
                  outline: 'none',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
                onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handle2FA} className="flex flex-col gap-4">
            <div className="text-center">
              <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Two-factor authentication</h2>
              <p style={{ fontSize: '13px', color: colors.muted, marginTop: '6px' }}>
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>

            {error && (
              <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              inputMode="numeric"
              aria-label="6-digit code"
              autoFocus
              placeholder="000000"
              className="tabular-nums text-center"
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                padding: '12px',
                fontSize: '24px',
                letterSpacing: '8px',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />

            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              aria-busy={loading}
              className="w-full text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: GRADIENT,
                padding: spacing.ctaPad,
                borderRadius: radius.cta,
                fontSize: typeT.cta.size,
                fontWeight: typeT.cta.weight,
                letterSpacing: typeT.cta.letterSpacing,
              }}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        <p className="text-center mt-5" style={{ fontSize: '13px', color: colors.muted }}>
          Don&apos;t have an account?{' '}
          <Link href="/register" style={{ color: colors.purple, fontWeight: 600 }}>
            Sign up
          </Link>
        </p>
      </div>

      {/* Trust strip under card */}
      <div className="mt-6 flex items-center justify-center gap-5 text-white/80" style={{ fontSize: '11px' }}>
        <span>🔒 AUSTRAC</span>
        <span>⚡ Minutes</span>
        <span>★ 4.8/5</span>
      </div>
    </div>
  )
}
