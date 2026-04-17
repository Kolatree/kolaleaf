'use client'

import { useRef, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchWithTimeout, isAbortError } from '@/lib/http/fetch-with-timeout'
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

// Step 3 of the verify-first wizard: collect full name + AU address +
// password, POST /api/auth/complete-registration, and bounce to /kyc.
// Only on success does the User row get created and a session issued.

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const

function textInputStyle() {
  return {
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
    outline: 'none',
  } as const
}

function RegisterDetailsInner() {
  const router = useRouter()
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [fullName, setFullName] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateCode, setStateCode] = useState<(typeof AU_STATES)[number]>('NSW')
  const [postcode, setPostcode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Ref-based submit guard closes the small window between setLoading(true)
  // and React committing the disabled-button state. Protects against
  // double-submit from fast Enter presses, React 19 strict-mode double
  // invoke, or IME commit races — the server is idempotent-on-retry
  // but a double POST still wastes one tx round-trip.
  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    setLoading(true)

    try {
      const res = await fetchWithTimeout('/api/auth/complete-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          fullName,
          password,
          addressLine1,
          addressLine2: addressLine2.trim().length > 0 ? addressLine2 : undefined,
          city,
          state: stateCode,
          postcode,
        }),
        // Complete-registration runs a 7-write transaction. 30s keeps
        // the UI responsive under Railway Postgres p99 latency while
        // still failing visibly if the server genuinely wedges.
        timeoutMs: 30_000,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Branch on reason so recovery paths route correctly instead of
        // leaving the user stranded on a form that can't succeed.
        if (data.reason === 'no_pending_verification' || data.reason === 'pending_not_verified') {
          router.push(`/register/verify?email=${encodeURIComponent(email)}`)
          return
        }
        if (data.reason === 'claim_expired') {
          router.push('/register')
          return
        }
        setError(data.error || 'Registration failed')
        return
      }

      router.push('/kyc')
    } catch (err) {
      setError(
        isAbortError(err)
          ? 'The server is slow to respond. Please try again.'
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
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
    <div className="w-full max-w-md kola-card-enter">
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>Finish your account</h2>

          <div
            style={{
              background: '#f8f7ff',
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '13px',
              color: colors.muted,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span>
              Email: <strong style={{ color: colors.ink }}>{email}</strong>
            </span>
            <Link href="/register" style={{ color: colors.purple, fontSize: '13px', fontWeight: 600 }}>
              Edit
            </Link>
          </div>

          {error && (
            <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
              {error}
            </div>
          )}

          <label className="flex flex-col gap-2">
            <FieldLabel>Full name</FieldLabel>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
              placeholder="As it appears on your ID document"
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>

          <label className="flex flex-col gap-2">
            <FieldLabel>Address line 1</FieldLabel>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              required
              autoComplete="address-line1"
              placeholder="1 George Street"
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>

          <label className="flex flex-col gap-2">
            <FieldLabel>Address line 2 (optional)</FieldLabel>
            <input
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              autoComplete="address-line2"
              placeholder="Apt, suite, etc."
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>

          <label className="flex flex-col gap-2">
            <FieldLabel>Suburb / City</FieldLabel>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              autoComplete="address-level2"
              placeholder="Sydney"
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2">
              <FieldLabel>State</FieldLabel>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value as (typeof AU_STATES)[number])}
                required
                autoComplete="address-level1"
                style={textInputStyle()}
              >
                {AU_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <FieldLabel>Postcode</FieldLabel>
              <input
                type="text"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                placeholder="2000"
                style={textInputStyle()}
                onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
                onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <FieldLabel>Country</FieldLabel>
            <input
              type="text"
              value="Australia"
              disabled
              style={{ ...textInputStyle(), background: '#f5f6fa', color: colors.muted }}
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
              autoComplete="new-password"
              placeholder="At least 8 characters"
              style={textInputStyle()}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
            <span style={{ fontSize: '12px', color: colors.muted }}>
              8+ characters with at least 3 of: lowercase, uppercase, digit, special character.
            </span>
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>

      <div className="mt-6 flex items-center justify-center gap-5 text-white/80" style={{ fontSize: '11px' }}>
        <span>🔒 AUSTRAC</span>
        <span>⚡ Minutes</span>
        <span>★ 4.8/5</span>
      </div>
    </div>
  )
}

export default function RegisterDetailsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#fff' }}>Loading…</div>}>
      <RegisterDetailsInner />
    </Suspense>
  )
}
