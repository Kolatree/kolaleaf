'use client'

import { useState, useEffect } from 'react'
import { DashboardShell, colors, radius, shadow, GRADIENT } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

interface Transfer {
  id: string
  sendAmount: string
  sendCurrency: string
  receiveAmount: string
  receiveCurrency: string
  status: string
  createdAt: string
  recipient?: { fullName: string }
}

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  COMPLETED:         { bg: 'rgba(26,107,60,0.10)', fg: colors.green,  label: 'Delivered' },
  NGN_SENT:          { bg: 'rgba(26,107,60,0.10)', fg: colors.green,  label: 'Sent' },
  CREATED:           { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, label: 'Pending' },
  AWAITING_AUD:      { bg: 'rgba(255,215,0,0.20)',  fg: '#8a6d0a',    label: 'Awaiting AUD' },
  AUD_RECEIVED:      { bg: 'rgba(45,27,105,0.10)',  fg: colors.purple, label: 'AUD received' },
  PROCESSING_NGN:    { bg: 'rgba(255,215,0,0.20)',  fg: '#8a6d0a',    label: 'Sending…' },
  CANCELLED:         { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, label: 'Cancelled' },
  EXPIRED:           { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, label: 'Expired' },
  NGN_FAILED:        { bg: 'rgba(176,0,32,0.10)',   fg: '#b00020',    label: 'Failed' },
  NGN_RETRY:         { bg: 'rgba(255,215,0,0.20)',  fg: '#8a6d0a',    label: 'Retrying' },
  NEEDS_MANUAL:      { bg: 'rgba(255,140,0,0.18)',  fg: '#8a4a0a',    label: 'Needs review' },
  REFUNDED:          { bg: 'rgba(45,27,105,0.10)',  fg: colors.purple, label: 'Refunded' },
  FLOAT_INSUFFICIENT:{ bg: 'rgba(255,215,0,0.20)',  fg: '#8a6d0a',    label: 'Paused' },
}

function formatAmount(amount: string, currency: string): string {
  const num = parseFloat(amount)
  if (currency === 'NGN') return '₦' + Math.floor(num).toLocaleString('en-NG')
  return 'A$' + num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ActivityPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch('transfers')
        if (res.ok) {
          const data = await res.json()
          setTransfers(data.transfers)
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <DashboardShell active="Activity">
      <div className="max-w-[900px] mx-auto">
        <div className="mb-6">
          <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Transfer history
          </div>
          <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
            Activity
          </h1>
        </div>

        <div
          style={{ background: colors.cardBg, borderRadius: radius.card, boxShadow: shadow.card, overflow: 'hidden' }}
        >
          {loading ? (
            <div className="p-10 text-center" style={{ color: colors.muted, fontSize: '14px' }}>Loading…</div>
          ) : transfers.length === 0 ? (
            <div className="p-10 text-center">
              <p style={{ fontWeight: 600, color: colors.ink }}>No transfers yet</p>
              <p className="mt-1" style={{ fontSize: '13px', color: colors.muted }}>Your transfer history will appear here.</p>
            </div>
          ) : (
            <ul className="kola-stagger">
              {transfers.map((t, i) => {
                const tone = STATUS_TONE[t.status] ?? { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, label: t.status.replace(/_/g, ' ') }
                return (
                  <li key={t.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
                    <a
                      href={`/activity/${t.id}`}
                      className="flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="grid place-items-center shrink-0"
                          style={{ width: '40px', height: '40px', borderRadius: '20px', background: GRADIENT, color: '#fff', fontSize: '12px', fontWeight: 700 }}
                        >
                          {(t.recipient?.fullName ?? '?').split(' ').map((n) => n[0]).slice(0, 2).join('')}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate" style={{ fontWeight: 600, fontSize: '14px', color: colors.ink }}>
                            {t.recipient?.fullName ?? 'Unknown recipient'}
                          </p>
                          <p style={{ fontSize: '12px', color: colors.muted }}>{formatDate(t.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p style={{ fontSize: '14px', fontWeight: 600, color: colors.ink }} className="tabular-nums">
                          {formatAmount(t.sendAmount, t.sendCurrency)}
                        </p>
                        <p className="tabular-nums" style={{ fontSize: '12px', color: colors.green }}>
                          {formatAmount(t.receiveAmount, t.receiveCurrency)}
                        </p>
                        <span
                          className="inline-block mt-1"
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: tone.bg,
                            color: tone.fg,
                          }}
                        >
                          {tone.label}
                        </span>
                      </div>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
