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
  textInputStyle,
} from '@/components/design/KolaPrimitives'
import { AuthShell } from '@/components/design/AuthShell'
import { AU_STATES, type AuState } from '@/lib/auth/constants'
import { useWizardSubmit } from '@/lib/hooks/use-wizard-submit'
import { REGISTER_TIMEOUT_MS } from '@/lib/http/fetch-with-timeout'

// Step 3 of the verify-first wizard: collect full name + AU address +
// password, POST /api/auth/complete-registration, and bounce to /kyc.
// Only on success does the User row get created and a session issued.
function RegisterDetailsInner() {
  const router = useRouter()
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [fullName, setFullName] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateCode, setStateCode] = useState<AuState>('NSW')
  const [postcode, setPostcode] = useState('')
  const [password, setPassword] = useState('')
  const { submit, error, loading } = useWizardSubmit()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit({
      endpoint: '/api/auth/complete-registration',
      body: {
        email,
        fullName,
        password,
        addressLine1,
        addressLine2: addressLine2.trim().length > 0 ? addressLine2 : undefined,
        city,
        state: stateCode,
        postcode,
      },
      timeoutMs: REGISTER_TIMEOUT_MS,
      onOk: () => router.push('/kyc'),
      onFail: (data) => {
        // Reason-driven recovery routing.
        if (data.reason === 'no_pending_verification' || data.reason === 'pending_not_verified') {
          router.push(`/register/verify?email=${encodeURIComponent(email)}`)
          return null
        }
        if (data.reason === 'claim_expired') {
          router.push('/register')
          return null
        }
      },
    })
  }

  if (!email) {
    return (
      <div className="w-full max-w-md kola-card-enter text-center" style={{ color: colors.cardBg }}>
        <p style={{ marginBottom: 12 }}>We lost track of your email. Please start over.</p>
        <Link href="/register" style={{ color: colors.cardBg, textDecoration: 'underline' }}>
          Back to register
        </Link>
      </div>
    )
  }

  return (
    <AuthShell width="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 style={{ fontSize: '18px', fontWeight: 600, textAlign: 'center' }}>Your details</h2>
        <p style={{ fontSize: '13px', color: colors.muted, textAlign: 'center', margin: 0 }}>
          Verifying <strong>{email}</strong>.{' '}
          <Link href="/register" style={{ color: colors.purple, fontWeight: 600 }}>
            Edit
          </Link>
        </p>

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
            style={textInputStyle}
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
            style={textInputStyle}
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
            placeholder="Apartment, suite, unit"
            style={textInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
            onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <FieldLabel>Suburb / City</FieldLabel>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              autoComplete="address-level2"
              placeholder="Sydney"
              style={textInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>
          <label className="flex flex-col gap-2">
            <FieldLabel>State</FieldLabel>
            <select
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value as AuState)}
              required
              style={textInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            >
              {AU_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <FieldLabel>Postcode</FieldLabel>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
              autoComplete="postal-code"
              placeholder="2000"
              style={textInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = colors.purple)}
              onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
            />
          </label>
          <label className="flex flex-col gap-2">
            <FieldLabel>Country</FieldLabel>
            <input
              type="text"
              value="Australia"
              disabled
              style={{ ...textInputStyle, background: '#f6f7fb', color: colors.muted }}
            />
          </label>
        </div>

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
            style={textInputStyle}
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
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  )
}

export default function RegisterDetailsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#fff' }}>Loading…</div>}>
      <RegisterDetailsInner />
    </Suspense>
  )
}
