'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardShell, colors, radius, shadow, spacing } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'
import { TwoFactorSection } from './_components/two-factor-section'
import { AccountIdentitySection } from './_components/account-identity-section'
import { getKycAction, isAllowedSumsubUrl } from './kyc-actions'

interface KycStatus {
  status: string
  applicantId?: string
}

const KYC_PILL: Record<string, { bg: string; fg: string; text: string }> = {
  VERIFIED:  { bg: 'rgba(26,107,60,0.10)', fg: colors.green, text: 'Verified' },
  PENDING:   { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, text: 'Not started' },
  IN_REVIEW: { bg: 'rgba(255,215,0,0.20)',  fg: '#8a6d0a', text: 'In review' },
  REJECTED:  { bg: 'rgba(176,0,32,0.10)',   fg: '#b00020', text: 'Rejected' },
}

export default function AccountPage() {
  const router = useRouter()
  const [kyc, setKyc] = useState<KycStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [kycSubmitting, setKycSubmitting] = useState(false)
  const [kycError, setKycError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch('kyc/status')
        if (res.ok) {
          const data = await res.json()
          setKyc(data)
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await apiFetch('auth/logout', { method: 'POST' })
    } catch {
      // Proceed even if logout API fails
    }
    router.push('/login')
  }

  async function handleKycAction() {
    const action = getKycAction(kyc?.status)
    if (!action) return

    setKycError('')
    setKycSubmitting(true)
    try {
      const res = await apiFetch(action.endpoint, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setKycError(typeof data.error === 'string' ? data.error : 'Unable to start verification right now.')
        return
      }

      if (isAllowedSumsubUrl(data.verificationUrl)) {
        window.location.href = data.verificationUrl
        return
      }

      setKycError('Verification link is unavailable right now. Please try again.')
    } catch {
      setKycError('Unable to start verification right now. Please try again.')
    } finally {
      setKycSubmitting(false)
    }
  }

  const pill = kyc ? KYC_PILL[kyc.status] ?? KYC_PILL.PENDING : null
  const kycAction = getKycAction(kyc?.status)

  return (
    <DashboardShell active="Account">
      <div className="max-w-[720px] mx-auto space-y-4 kola-stagger">
        <div>
          <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Your settings
          </div>
          <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
            Account
          </h1>
        </div>

        {/* Profile + credentials */}
        <AccountIdentitySection />

        {/* KYC */}
        <section style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Identity verification</h2>
              <p className="mt-1" style={{ fontSize: '12px', color: colors.muted }}>
                Required to send money — AUSTRAC / AML/CTF compliance.
              </p>
            </div>
            {loading ? (
              <span className="kola-shimmer" style={{ width: '80px', height: '24px', borderRadius: '999px' }} />
            ) : (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: pill?.bg,
                  color: pill?.fg,
                }}
              >
                {pill?.text}
              </span>
            )}
          </div>

          {kyc && (kyc.status === 'PENDING' || kyc.status === 'REJECTED') && (
            <>
              <button
                type="button"
                onClick={handleKycAction}
                disabled={kycSubmitting}
                className="mt-4 disabled:opacity-60"
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: colors.purple,
                }}
              >
                {kycSubmitting ? 'Starting…' : kycAction?.label}
              </button>
              {kycError && (
                <div
                  role="alert"
                  className="mt-3"
                  style={{
                    background: '#fef1f2',
                    color: '#b00020',
                    fontSize: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                  }}
                >
                  {kycError}
                </div>
              )}
            </>
          )}
        </section>

        {/* Security — 2FA */}
        <TwoFactorSection />

        {/* Trust strip */}
        <section
          style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Why Kolaleaf</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Badge icon="🔒" title="AUSTRAC" sub="Registered" />
            <Badge icon="⚡" title="Minutes" sub="Delivery" />
            <Badge icon="★"  title="4.8 / 5" sub="Trust score" />
          </div>
        </section>

        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full disabled:opacity-60"
          style={{
            background: colors.cardBg,
            borderRadius: radius.card,
            padding: spacing.cardPad,
            boxShadow: shadow.card,
            color: '#b00020',
            fontWeight: 600,
            fontSize: '14px',
          }}
        >
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </DashboardShell>
  )
}

function Badge({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: '22px' }}>{icon}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: colors.ink, marginTop: '4px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: colors.muted }}>{sub}</div>
    </div>
  )
}
