'use client'

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

// Post-registration KYC prompt. Skippable at this stage — the hard
// block lives at transfer creation (KYC gates PayID per CLAUDE.md).

// Refuse any redirect that isn't a Sumsub host over HTTPS. A future
// Sumsub misconfiguration or a header-injected response cannot turn
// this page into an open redirect.
function isAllowedSumsubUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return url.host === 'sumsub.com' || url.host.endsWith('.sumsub.com')
}

export default function KycPage() {
  const router = useRouter()
  const { submit, error, loading } = useWizardSubmit()

  async function handleVerifyNow() {
    await submit({
      endpoint: 'kyc/initiate',
      onOk: (data) => {
        if (isAllowedSumsubUrl(data.verificationUrl)) {
          window.location.href = data.verificationUrl as string
          return
        }
        // No URL returned or unknown origin — fall through to the
        // dashboard; the user can retry from /account.
        router.push('/send')
      },
    })
  }

  return (
    <AuthShell fullScreen>
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

      <button
        type="button"
        onClick={handleVerifyNow}
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
          marginTop: 20,
        }}
      >
        {loading ? 'Starting…' : 'Verify identity now'}
      </button>

      <p className="text-center mt-4" style={{ fontSize: '13px', color: colors.muted }}>
        <Link href="/send" style={{ color: colors.muted, textDecoration: 'underline' }}>
          Skip for now
        </Link>
      </p>
    </AuthShell>
  )
}
