'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminShell, colors, radius, shadow, GRADIENT } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

const STATUSES = [
  'ALL', 'CREATED', 'AWAITING_AUD', 'AUD_RECEIVED', 'PROCESSING_NGN',
  'NGN_SENT', 'COMPLETED', 'NGN_FAILED', 'NGN_RETRY', 'NEEDS_MANUAL',
  'REFUNDED', 'CANCELLED', 'EXPIRED', 'FLOAT_INSUFFICIENT',
]

interface TransferRow {
  id: string
  sendAmount: string
  sendCurrency: string
  receiveAmount: string
  receiveCurrency: string
  status: string
  createdAt: string
  user: { id: string; fullName: string }
  recipient: { id: string; fullName: string; bankName: string }
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  COMPLETED:      { bg: 'rgba(26,107,60,0.10)', fg: colors.green },
  NGN_SENT:       { bg: 'rgba(26,107,60,0.10)', fg: colors.green },
  PROCESSING_NGN: { bg: 'rgba(255,215,0,0.20)', fg: '#8a6d0a' },
  AWAITING_AUD:   { bg: 'rgba(255,215,0,0.20)', fg: '#8a6d0a' },
  NGN_RETRY:      { bg: 'rgba(255,215,0,0.20)', fg: '#8a6d0a' },
  NEEDS_MANUAL:   { bg: 'rgba(255,140,0,0.18)', fg: '#8a4a0a' },
  NGN_FAILED:     { bg: 'rgba(176,0,32,0.10)',  fg: '#b00020' },
  REFUNDED:       { bg: 'rgba(45,27,105,0.10)', fg: colors.purple },
  CANCELLED:      { bg: 'rgba(136,136,136,0.15)', fg: colors.muted },
  EXPIRED:        { bg: 'rgba(136,136,136,0.15)', fg: colors.muted },
}

export default function AdminTransfersPage() {
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  const fetchTransfers = useCallback(async (cursor?: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (status !== 'ALL') params.set('status', status)
    if (search) params.set('search', search)
    if (cursor) params.set('cursor', cursor)

    const res = await apiFetch(`admin/transfers?${params}`)
    if (res.ok) {
      const data = await res.json()
      if (cursor) setTransfers((prev) => [...prev, ...data.transfers])
      else setTransfers(data.transfers)
      setNextCursor(data.nextCursor)
    }
    setLoading(false)
  }, [status, search])

  useEffect(() => {
    fetchTransfers()
  }, [fetchTransfers])

  return (
    <AdminShell active="Transfers">
      <div className="mb-6">
        <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Operations
        </div>
        <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
          Transfers
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '13px',
            background: colors.cardBg,
            color: colors.ink,
          }}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search user or recipient…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchTransfers()}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '13px',
            background: colors.cardBg,
            color: colors.ink,
            width: '280px',
          }}
        />
        <button
          type="button"
          onClick={() => fetchTransfers()}
          className="text-white transition hover:brightness-110"
          style={{ background: GRADIENT, padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}
        >
          Search
        </button>
      </div>

      {/* Table card */}
      <div style={{ background: colors.cardBg, borderRadius: radius.card, boxShadow: shadow.card, overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead style={{ background: colors.pageBg, borderBottom: `1px solid ${colors.border}` }}>
              <tr>
                <Th>ID</Th>
                <Th>Sender</Th>
                <Th>Recipient</Th>
                <Th align="right">Send</Th>
                <Th align="right">Receive</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t, i) => {
                const tone = STATUS_TONE[t.status] ?? { bg: 'rgba(136,136,136,0.15)', fg: colors.muted }
                return (
                  <tr key={t.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }} className="hover:bg-[#fafafa] transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/transfers/${t.id}`} className="font-mono" style={{ color: colors.purple, fontSize: '12px' }}>
                        {t.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: colors.ink }}>{t.user.fullName}</td>
                    <td className="px-4 py-3" style={{ color: colors.ink }}>{t.recipient.fullName}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: colors.ink }}>
                      {Number(t.sendAmount).toLocaleString()} {t.sendCurrency}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: colors.green }}>
                      {Number(t.receiveAmount).toLocaleString()} {t.receiveCurrency}
                    </td>
                    <td className="px-4 py-3">
                      <span
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
                        {t.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: colors.muted, fontSize: '12px' }}>
                      {new Date(t.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
              {!loading && transfers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center" style={{ color: colors.muted }}>
                    No transfers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {nextCursor && (
        <button
          type="button"
          onClick={() => fetchTransfers(nextCursor)}
          disabled={loading}
          className="mt-4"
          style={{
            border: `1px solid ${colors.border}`,
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '13px',
            fontWeight: 600,
            color: colors.ink,
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </AdminShell>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-4 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.muted }}
    >
      {children}
    </th>
  )
}
