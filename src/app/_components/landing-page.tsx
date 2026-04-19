'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  KolaLogo,
  TransferCard,
  colors,
  radius,
  shadow,
  spacing,
  type as typeT,
  GRADIENT,
} from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

// Fallback rate matches the approved sketch (1 AUD = 1,042.50 NGN).
// Overridden by a live fetch if the public endpoint is reachable.
const FALLBACK_RATE = 1042.5

export function LandingPage() {
  const [rate, setRate] = useState<number>(FALLBACK_RATE)
  const [amount, setAmount] = useState<number>(1000)

  useEffect(() => {
    let cancelled = false
    async function fetchRate() {
      try {
        const res = await apiFetch('rates/public?base=AUD&target=NGN')
        if (res.ok) {
          const data = await res.json()
          const val = parseFloat(data.customerRate)
          if (!cancelled && !Number.isNaN(val) && val > 0) setRate(val)
        }
      } catch {
        // Keep fallback rate — corridor config may be missing in dev.
      }
    }
    fetchRate()
    return () => { cancelled = true }
  }, [])

  // Header + footer are provided by src/app/(marketing)/layout.tsx — this
  // component only renders the page body.
  return (
    <div style={{ color: colors.ink }}>
      {/* Hero */}
      <section className="max-w-[1160px] mx-auto px-6 pt-12 md:pt-20 pb-16 md:pb-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center kola-page-enter">
        <div>
          <div className="inline-flex items-center gap-2 mb-5" style={{ background: colors.bgSoft, color: colors.green, fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '999px' }}>
            <span>🇦🇺</span>
            <span>→</span>
            <span>🇳🇬</span>
            <span style={{ marginLeft: '4px' }}>AUD to NGN · Live</span>
          </div>
          <h1
            style={{
              fontSize: 'clamp(40px, 6vw, 64px)',
              fontWeight: 700,
              letterSpacing: '-1px',
              lineHeight: 1.05,
              color: colors.ink,
            }}
          >
            Send to Nigeria.<br />
            <span
              style={{
                background: GRADIENT,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              Best rate. Every time.
            </span>
          </h1>
          <p className="mt-5 max-w-md" style={{ fontSize: '16px', color: colors.muted, lineHeight: 1.55 }}>
            AUSTRAC-registered. Delivered in minutes. Zero fees. Built by Nigerian-Australians
            who know the corridor — because we&apos;ve been running it for years.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="text-white transition hover:brightness-110"
              style={{
                background: GRADIENT,
                padding: spacing.ctaPad,
                borderRadius: radius.cta,
                fontSize: typeT.cta.size,
                fontWeight: typeT.cta.weight,
                letterSpacing: typeT.cta.letterSpacing,
              }}
            >
              Start sending →
            </Link>
            <Link
              href="/login"
              className="transition hover:bg-neutral-50"
              style={{
                border: `1px solid ${colors.border}`,
                background: colors.cardBg,
                color: colors.ink,
                padding: spacing.ctaPad,
                borderRadius: radius.cta,
                fontSize: typeT.cta.size,
                fontWeight: 600,
              }}
            >
              I have an account
            </Link>
          </div>

          {/* Trust strip under CTA */}
          <div className="mt-8 flex flex-wrap gap-5 kola-stagger" style={{ fontSize: '12px', color: colors.muted }}>
            <span>🔒 AUSTRAC Registered</span>
            <span>⚡ Delivered in minutes</span>
            <span>★ 4.8/5 · 1,247 reviews</span>
          </div>
        </div>

        {/* Right: gradient-framed live card */}
        <div className="flex justify-center md:justify-end kola-card-enter">
          <div
            className="relative p-6 md:p-8"
            style={{ background: GRADIENT, borderRadius: radius.hero, boxShadow: shadow.lifted }}
          >
            <div className="mb-5 text-white">
              <KolaLogo tone="onDark" />
              <div style={{ fontSize: typeT.tagline.size, opacity: 0.8, marginTop: '2px' }}>
                Fast. Secure. Better rates to Nigeria.
              </div>
            </div>
            <TransferCard
              amountAud={amount}
              onAmountChange={setAmount}
              rateCustomer={rate}
              feeAud={0}
            />
          </div>
        </div>
      </section>

      {/* Social proof strip */}
      <section style={{ background: colors.cardBg, borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>
        <div className="max-w-[1160px] mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <ProofTile big="1,247+" label="senders trust Kolaleaf" />
          <ProofTile big="AUSTRAC" label="registered remitter" />
          <ProofTile big="~45 sec" label="typical delivery time" />
          <ProofTile big="4.8/5" label="average rating" />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-[1160px] mx-auto px-6 py-16 md:py-24">
        <div className="text-center mb-10">
          <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            How it works
          </div>
          <h2 className="mt-2" style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.5px', color: colors.ink }}>
            From sign-up to landed in minutes
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4 kola-stagger">
          <StepCard n={1} title="Verify identity" body="Create an account and complete Sumsub identity verification. Usually takes 3 minutes." time="≈ 3 min" />
          <StepCard n={2} title="Add a recipient" body="Enter a Nigerian bank account — GTBank, Access, Zenith, or any NGN bank." time="≈ 30 sec" />
          <StepCard n={3} title="Send and track" body="PayID to us. We deliver to NGN bank. Track status live until delivered." time="Minutes" />
        </div>
      </section>

      {/* Why Kolaleaf */}
      <section id="why" style={{ background: colors.cardBg, borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>
        <div className="max-w-[1160px] mx-auto px-6 py-16 md:py-24">
          <div className="max-w-xl">
            <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Why Kolaleaf
            </div>
            <h2 className="mt-2" style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.5px', color: colors.ink }}>
              Not just another remittance app.
            </h2>
            <p className="mt-3" style={{ fontSize: '16px', color: colors.muted, lineHeight: 1.55 }}>
              Kolaleaf is a licensed AUD float engine — we deploy smarter, so we can price
              better. You get the rate advantage. We get the margin that keeps us honest.
            </p>
          </div>

          <div className="mt-10 grid md:grid-cols-2 gap-4 kola-stagger">
            <FeatureCard icon="💸" title="Better rates — structurally" body="Our margin comes from treasury, not fees. So we can undercut incumbents without racing to zero." />
            <FeatureCard icon="🛡️" title="AUSTRAC-registered" body="Licensed remitter. Compliant with Australia's AML/CTF framework. Your money is protected." />
            <FeatureCard icon="🌏" title="Built by operators" body="We ran CashRemit in the same corridor for 4 years. We know the banks, the pain points, the fraud patterns." />
            <FeatureCard icon="⚡" title="Delivered in minutes" body="PayID collection, BudPay + Flutterwave disbursement with failover. No overnight batches." />
          </div>
        </div>
      </section>

      {/* Final CTA band */}
      <section className="max-w-[1160px] mx-auto px-6 py-16 md:py-24">
        <div
          className="relative p-10 md:p-14 text-center text-white overflow-hidden"
          style={{ background: GRADIENT, borderRadius: radius.hero, boxShadow: shadow.lifted }}
        >
          <h2 style={{ fontSize: 'clamp(30px, 5vw, 48px)', fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
            Ready to send?
          </h2>
          <p className="mt-3 mx-auto max-w-md" style={{ fontSize: '15px', opacity: 0.9 }}>
            Create your account in under 3 minutes. First transfer could be landing in Lagos before lunch.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 justify-center">
            <Link
              href="/register"
              className="transition hover:brightness-110"
              style={{
                background: colors.cardBg,
                color: colors.purple,
                padding: spacing.ctaPad,
                borderRadius: radius.cta,
                fontSize: typeT.cta.size,
                fontWeight: 700,
                letterSpacing: typeT.cta.letterSpacing,
              }}
            >
              Start sending →
            </Link>
            <Link
              href="/login"
              className="transition hover:bg-white/10"
              style={{
                border: `1px solid rgba(255,255,255,0.4)`,
                color: '#fff',
                padding: spacing.ctaPad,
                borderRadius: radius.cta,
                fontSize: typeT.cta.size,
                fontWeight: 600,
              }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}

function ProofTile({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>{big}</div>
      <div className="mt-1" style={{ fontSize: '12px', color: colors.muted }}>{label}</div>
    </div>
  )
}

function StepCard({ n, title, body, time }: { n: number; title: string; body: string; time: string }) {
  return (
    <div
      className="relative"
      style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
    >
      <span
        className="grid place-items-center"
        style={{ width: '36px', height: '36px', borderRadius: '18px', background: GRADIENT, color: '#fff', fontSize: '14px', fontWeight: 700 }}
      >
        {n}
      </span>
      <h3 className="mt-4" style={{ fontSize: '16px', fontWeight: 600, color: colors.ink }}>{title}</h3>
      <p className="mt-1.5" style={{ fontSize: '13px', color: colors.muted, lineHeight: 1.55 }}>{body}</p>
      <span
        className="inline-block mt-4"
        style={{ fontSize: '11px', fontWeight: 600, color: colors.green, background: colors.bgSoft, padding: '3px 10px', borderRadius: '999px' }}
      >
        {time}
      </span>
    </div>
  )
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div
      style={{
        background: colors.pageBg,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        padding: spacing.cardPad,
      }}
    >
      <div style={{ fontSize: '26px' }}>{icon}</div>
      <h3 className="mt-3" style={{ fontSize: '16px', fontWeight: 600, color: colors.ink }}>{title}</h3>
      <p className="mt-1.5" style={{ fontSize: '13px', color: colors.muted, lineHeight: 1.55 }}>{body}</p>
    </div>
  )
}

