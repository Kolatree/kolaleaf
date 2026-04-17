'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchWithTimeout, isAbortError } from '@/lib/http/fetch-with-timeout'

// Hosts we are willing to redirect to after /api/kyc/initiate. Sumsub's
// production WebSDK hosts live under *.sumsub.com; their sandbox uses
// api.sumsub.com as well. We refuse any other origin so a header-injection
// or provider-misconfiguration can't turn this page into an open redirect.
const KYC_ALLOWED_HOSTS = new Set([
  'api.sumsub.com',
  'in-mobile-sdk.sumsub.com',
  'websdk.sumsub.com',
  'test-api.sumsub.com',
])

function isAllowedSumsubUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return KYC_ALLOWED_HOSTS.has(url.host) || url.host.endsWith('.sumsub.com')
}
import {
  KolaLogo,
  Tagline,
  colors,
  radius,
  shadow,
  spacing,
  type as typeT,
  GRADIENT,
} from '@/components/design/KolaPrimitives'

// Post-registration KYC prompt. Skippable at this stage — the hard block
// lives at transfer creation (requireKyc in the transfer route, per
// CLAUDE.md). We surface the Sumsub initiate endpoint but let users
// continue to the app if they're not ready.

export default function KycPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleVerifyNow() {
    setError('')
    setLoading(true)
    try {
      const res = await fetchWithTimeout('/api/kyc/initiate', {
        method: 'POST',
        timeoutMs: 20_000,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not start identity verification')
        return
      }
      // Only follow the redirect if the URL is demonstrably a Sumsub
      // host over HTTPS. An attacker-controlled response body (or a
      // future provider misconfiguration) cannot turn this page into
      // an open redirect.
      if (isAllowedSumsubUrl(data.verificationUrl)) {
        window.location.href = data.verificationUrl
        return
      }
      // No URL returned or unknown origin — fall through to the
      // dashboard. The backend will have recorded what it could, and
      // the user can retry from /account.
      router.push('/send')
    } catch (err) {
      setError(
        isAbortError(err)
          ? 'The server is slow to respond. Please try again.'
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: colors.pageBg }}>
      <main
        className="flex-1 flex items-center justify-center px-4 py-14 md:py-20"
        style={{ background: GRADIENT }}
      >
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
          </div>

          <div className="mt-6 flex items-center justify-center gap-5 text-white/80" style={{ fontSize: '11px' }}>
            <span>🔒 AUSTRAC</span>
            <span>⚡ Minutes</span>
            <span>★ 4.8/5</span>
          </div>
        </div>
      </main>
    </div>
  )
}
