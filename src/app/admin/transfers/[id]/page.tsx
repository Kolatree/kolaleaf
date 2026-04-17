'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { AdminShell, colors, radius, shadow, spacing, GRADIENT } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

interface TransferEvent {
  id: string
  fromStatus: string
  toStatus: string
  actor: string
  actorId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface TransferDetail {
  id: string
  userId: string
  sendAmount: string
  sendCurrency: string
  receiveAmount: string
  receiveCurrency: string
  exchangeRate: string
  fee: string
  status: string
  payidReference: string | null
  payoutProvider: string | null
  payoutProviderRef: string | null
  failureReason: string | null
  retryCount: number
  createdAt: string
  completedAt: string | null
  user: { id: string; fullName: string }
  recipient: { id: string; fullName: string; bankName: string }
  events: TransferEvent[]
}

export default function AdminTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [transfer, setTransfer] = useState<TransferDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function fetchTransfer() {
    const res = await apiFetch(`admin/transfers/${id}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to load transfer')
      return
    }
    const data = await res.json()
    setTransfer(data.transfer)
  }

  useEffect(() => {
    fetchTransfer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleRetry() {
    setActionLoading(true)
    setError(null)
    const res = await apiFetch(`admin/transfers/${id}/retry`, { method: 'POST' })
    if (res.ok) await fetchTransfer()
    else {
      const data = await res.json()
      setError(data.error ?? 'Retry failed')
    }
    setActionLoading(false)
  }

  async function handleRefund() {
    setActionLoading(true)
    setError(null)
    const res = await apiFetch(`admin/transfers/${id}/refund`, { method: 'POST' })
    if (res.ok) await fetchTransfer()
    else {
      const data = await res.json()
      setError(data.error ?? 'Refund failed')
    }
    setActionLoading(false)
  }

  return (
    <AdminShell active="Transfers">
      <Link href="/admin/transfers" className="inline-block mb-4" style={{ fontSize: '12px', color: colors.purple, fontWeight: 600 }}>
        ← Back to transfers
      </Link>

      {!transfer && !error && (
        <div style={{ fontSize: '14px', color: colors.muted }}>Loading…</div>
      )}
      {error && !transfer && (
        <div role="alert" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {transfer && (
        <>
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
            <div>
              <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Transfer
              </div>
              <h1 className="mt-1 font-mono" style={{ fontSize: '22px', fontWeight: 700, color: colors.ink }}>
                {transfer.id.slice(0, 12)}…
              </h1>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '999px',
                background: 'rgba(45,27,105,0.10)',
                color: colors.purple,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {transfer.status.replace(/_/g, ' ')}
            </span>
          </div>

          {error && (
            <div role="alert" className="mb-4" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
              {error}
            </div>
          )}

          {/* Summary grid */}
          <section
            className="mb-6"
            style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <Field label="Sender" value={transfer.user.fullName} />
              <Field label="Recipient" value={`${transfer.recipient.fullName} (${transfer.recipient.bankName})`} />
              <Field label="Send"    value={`${Number(transfer.sendAmount).toLocaleString()} ${transfer.sendCurrency}`} />
              <Field label="Receive" value={`${Number(transfer.receiveAmount).toLocaleString()} ${transfer.receiveCurrency}`} tone="green" />
              <Field label="Exchange rate" value={transfer.exchangeRate} />
              <Field label="Fee"     value={`${Number(transfer.fee).toLocaleString()} ${transfer.sendCurrency}`} />
              <Field label="PayID ref" value={transfer.payidReference ?? '—'} mono />
              <Field label="Payout provider" value={transfer.payoutProvider ?? '—'} />
              <Field label="Payout ref" value={transfer.payoutProviderRef ?? '—'} mono />
              <Field label="Retry count" value={String(transfer.retryCount)} />
              <Field label="Failure reason" value={transfer.failureReason ?? '—'} />
              <Field label="Created" value={new Date(transfer.createdAt).toLocaleString()} />
              <Field label="Completed" value={transfer.completedAt ? new Date(transfer.completedAt).toLocaleString() : '—'} />
            </div>
          </section>

          {/* Actions */}
          {transfer.status === 'NEEDS_MANUAL' && (
            <div className="flex gap-3 mb-6">
              <button
                type="button"
                onClick={handleRetry}
                disabled={actionLoading}
                className="text-white transition hover:brightness-110 disabled:opacity-60"
                style={{
                  background: GRADIENT,
                  padding: '10px 18px',
                  borderRadius: radius.cta,
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {actionLoading ? 'Processing…' : 'Retry payout'}
              </button>
              <button
                type="button"
                onClick={handleRefund}
                disabled={actionLoading}
                className="transition hover:brightness-110 disabled:opacity-60"
                style={{
                  background: '#b00020',
                  color: '#fff',
                  padding: '10px 18px',
                  borderRadius: radius.cta,
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {actionLoading ? 'Processing…' : 'Refund'}
              </button>
            </div>
          )}

          {/* Timeline */}
          {transfer.events.length > 0 && (
            <section style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Event timeline</h2>
              <ol
                className="mt-4 ml-3 space-y-4"
                style={{ borderLeft: `2px solid ${colors.border}` }}
              >
                {transfer.events.map((event) => (
                  <li key={event.id} className="pl-4 relative">
                    <span
                      className="absolute -left-[7px] top-1"
                      style={{ width: '12px', height: '12px', borderRadius: '6px', background: GRADIENT, border: `2px solid ${colors.cardBg}` }}
                    />
                    <p style={{ fontSize: '13px', fontWeight: 600, color: colors.ink }}>
                      {event.fromStatus.replace(/_/g, ' ')} → {event.toStatus.replace(/_/g, ' ')}
                    </p>
                    <p style={{ fontSize: '11px', color: colors.muted }}>
                      {event.actor}{event.actorId ? ` (${event.actorId.slice(0, 8)})` : ''} · {new Date(event.createdAt).toLocaleString()}
                    </p>
                    {event.metadata && (
                      <pre
                        className="mt-1 overflow-x-auto"
                        style={{ fontSize: '11px', color: colors.muted, background: colors.pageBg, padding: '8px 10px', borderRadius: '6px' }}
                      >
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </AdminShell>
  )
}

function Field({ label, value, tone, mono }: { label: string; value: string; tone?: 'green'; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div
        className={mono ? 'font-mono' : ''}
        style={{
          fontSize: '14px',
          fontWeight: 500,
          marginTop: '2px',
          color: tone === 'green' ? colors.green : colors.ink,
        }}
      >
        {value}
      </div>
    </div>
  )
}
