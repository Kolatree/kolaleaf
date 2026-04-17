'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { useWizardSubmit } from '@/lib/hooks/use-wizard-submit'

// Step 1 of the verify-first wizard: capture the email, request a
// 6-digit code, bounce to /register/verify. No User row is created yet;
// a PendingEmailVerification row is the only side effect.
export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const { submit, error, loading } = useWizardSubmit()

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    const normalized = email.trim().toLowerCase()
    await submit({
      endpoint: 'auth/send-code',
      body: { email: normalized },
      onOk: () => {
        // /send-code is enumeration-proof: always 200. We unconditionally
        // move the user to step 2 with the email in the URL.
        router.push(`/register/verify?email=${encodeURIComponent(normalized)}`)
      },
    })
  }

  return (
    <AuthShell>
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
            style={textInputStyle}
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
    </AuthShell>
  )
}
