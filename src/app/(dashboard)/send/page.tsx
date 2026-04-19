'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Decimal from 'decimal.js'
import {
  KolaLogo,
  Tagline,
  TransferCard,
  DashboardShell,
  FieldLabel,
  colors,
  radius,
  shadow,
  spacing,
  type as typeT,
  GRADIENT,
} from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

interface Recipient {
  id: string
  fullName: string
  bankName: string
  accountNumber: string
}

interface RateData {
  corridorId: string
  customerRate: string
  effectiveAt: string
}

export default function SendPage() {
  const router = useRouter()
  const [sendAmount, setSendAmount] = useState('1000')
  const [rate, setRate] = useState<RateData | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedRecipientId, setSelectedRecipientId] = useState('')
  const [kycVerified, setKycVerified] = useState<boolean | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const fetchRate = useCallback(async () => {
    try {
      const res = await apiFetch('rates/public?base=AUD&target=NGN')
      if (res.ok) {
        const data = await res.json()
        setRate(data)
        // Clear any prior rate-load error once a fresh quote arrives.
        setError((prev) => (prev === 'Could not load live rate. Please refresh.' ? '' : prev))
        return
      }
      setError('Could not load live rate. Please refresh.')
    } catch (err) {
      console.error('[send/page] rate fetch failed', err)
      setError('Could not load live rate. Please refresh.')
    }
  }, [])

  useEffect(() => {
    fetchRate()
    const interval = setInterval(fetchRate, 60_000)
    return () => clearInterval(interval)
  }, [fetchRate])

  useEffect(() => {
    async function load() {
      try {
        const [recipientsRes, kycRes] = await Promise.all([
          apiFetch('recipients'),
          apiFetch('kyc/status'),
        ])
        if (recipientsRes.ok) {
          const data = await recipientsRes.json()
          setRecipients(data.recipients)
          if (data.recipients.length > 0) {
            setSelectedRecipientId(data.recipients[0].id)
          }
        }
        if (kycRes.ok) {
          const data = await kycRes.json()
          setKycVerified(data.status === 'VERIFIED')
        }
      } catch {
        // Silent fail on initial load
      }
    }
    load()
  }, [])

  const amountNum = parseFloat(sendAmount) || 0
  const rateNum = rate ? parseFloat(rate.customerRate) : 0

  async function handleSend() {
    if (!selectedRecipientId || !rate) return
    setError('')
    setSending(true)

    try {
      const res = await apiFetch('transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientId: selectedRecipientId,
          corridorId: rate.corridorId,
          sendAmount,
          exchangeRate: rate.customerRate,
          fee: '0',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Transfer failed')
        return
      }

      const transferId = data?.transfer?.id as string | undefined
      if (!transferId) {
        setError('Transfer created, but the app could not open its detail page.')
        return
      }

      if (kycVerified) {
        const payIdRes = await apiFetch(`transfers/${transferId}/issue-payid`, {
          method: 'POST',
        })
        if (!payIdRes.ok && payIdRes.status !== 409) {
          const payIdData = await payIdRes
            .json()
            .catch(() => ({ error: 'Could not issue payment instructions.' }))
          setError(
            typeof payIdData.error === 'string'
              ? payIdData.error
              : 'Could not issue payment instructions.',
          )
          return
        }
      }

      router.push(`/activity/${transferId}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  // KYC no longer gates the Send action itself — it gates processing.
  // The button is live for anyone with a recipient + rate + amount.
  const canSend = !sending && rateNum > 0 && selectedRecipientId && amountNum > 0

  return (
    <DashboardShell
      active="Send"
      hero={
        <>
          {/* Left column — headline + chips */}
          <div>
            <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Send money to Nigeria
            </div>
            <h1
              className="mt-3"
              style={{
                fontSize: typeT.heroHeadline.size,
                fontWeight: typeT.heroHeadline.weight,
                letterSpacing: typeT.heroHeadline.letterSpacing,
                lineHeight: typeT.heroHeadline.lineHeight,
                color: colors.ink,
              }}
            >
              Better rates.<br />Delivered in minutes.
            </h1>
            <p className="mt-3 max-w-sm" style={{ fontSize: '14px', color: colors.muted, lineHeight: 1.55 }}>
              AUSTRAC-registered. Zero fees. Built by Nigerian-Australians who know the corridor.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 kola-stagger">
              <Chip icon="🔒" label="AUSTRAC Registered" />
              <Chip icon="⚡" label="Minutes delivery" />
              <Chip icon="★" label="4.8/5 · 1,247 reviews" />
            </div>

            {/* Recipient select + submit live under the chips on desktop */}
            <div
              className="mt-8"
              style={{
                background: colors.cardBg,
                borderRadius: radius.card,
                padding: spacing.cardPad,
                boxShadow: shadow.card,
                maxWidth: '440px',
              }}
            >
              <FieldLabel>Recipient</FieldLabel>
              {recipients.length === 0 ? (
                <div className="mt-3" style={{ fontSize: '13px', color: colors.muted }}>
                  You haven&apos;t added any recipients yet.{' '}
                  <Link href="/recipients" style={{ color: colors.purple, fontWeight: 600 }}>Add one →</Link>
                </div>
              ) : (
                <select
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  className="mt-2 w-full"
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: '8px',
                    padding: '10px 12px',
                    fontSize: '14px',
                    background: colors.cardBg,
                    color: colors.ink,
                  }}
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} — {r.bankName} · •••{r.accountNumber.slice(-4)}
                    </option>
                  ))}
                </select>
              )}

              {error && (
                <div role="alert" className="mt-3" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                aria-busy={sending}
                className="w-full text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: GRADIENT,
                  padding: spacing.ctaPad,
                  borderRadius: radius.cta,
                  fontSize: typeT.cta.size,
                  fontWeight: typeT.cta.weight,
                  letterSpacing: typeT.cta.letterSpacing,
                  marginTop: '12px',
                }}
              >
                {sending ? 'Sending…' : `Send A$${new Decimal(amountNum || 0).toFixed(2)}`}
              </button>

              {kycVerified === false && (
                <div
                  className="mt-3 flex items-center justify-between gap-2"
                  style={{ fontSize: '12px', color: colors.muted }}
                >
                  <span>
                    Processing requires identity verification.
                  </span>
                  <Link
                    href="/account"
                    style={{ color: colors.purple, fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    Verify now →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Right column — gradient frame wrapping the transfer card */}
          <div className="flex justify-center md:justify-end kola-card-enter">
            <div
              className="relative p-6 md:p-8"
              style={{ background: GRADIENT, borderRadius: radius.hero, boxShadow: shadow.lifted }}
            >
              <div className="mb-5 text-white">
                <KolaLogo tone="onDark" />
                <div className="mt-1"><Tagline tone="onDark" /></div>
              </div>
              {rateNum > 0 ? (
                <TransferCard
                  amountAud={amountNum}
                  onAmountChange={(v) => setSendAmount(String(v))}
                  rateCustomer={rateNum}
                  feeAud={0}
                  onSubmit={handleSend}
                  submitting={sending}
                />
              ) : (
                <div
                  className="kola-shimmer"
                  style={{ width: '420px', maxWidth: '100%', height: '420px', borderRadius: radius.card, background: colors.cardBg }}
                />
              )}
            </div>
          </div>
        </>
      }
    />
  )
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        padding: '6px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        color: colors.ink,
        fontWeight: 600,
      }}
    >
      <span>{icon}</span>
      {label}
    </span>
  )
}
