'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminShell, colors, radius, shadow } from '@/components/design/KolaPrimitives'

const REPORT_TYPES = ['ALL', 'THRESHOLD', 'SUSPICIOUS', 'IFTI']

interface ComplianceReport {
  id: string
  type: string
  transferId: string | null
  userId: string | null
  details: Record<string, unknown>
  reportedAt: string | null
  austracRef: string | null
  createdAt: string
}

const TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  THRESHOLD:  { bg: 'rgba(45,27,105,0.10)',  fg: colors.purple },
  SUSPICIOUS: { bg: 'rgba(176,0,32,0.10)',   fg: '#b00020' },
  IFTI:       { bg: 'rgba(26,107,60,0.10)',  fg: colors.green },
}

export default function AdminCompliancePage() {
  const [reports, setReports] = useState<ComplianceReport[]>([])
  const [type, setType] = useState('ALL')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  const fetchReports = useCallback(async (cursor?: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (type !== 'ALL') params.set('type', type)
    if (cursor) params.set('cursor', cursor)

    const res = await fetch(`/api/admin/compliance?${params}`)
    if (res.ok) {
      const data = await res.json()
      if (cursor) setReports((prev) => [...prev, ...data.reports])
      else setReports(data.reports)
      setNextCursor(data.nextCursor)
    }
    setLoading(false)
  }, [type])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  return (
    <AdminShell active="Compliance">
      <div className="mb-6">
        <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          AUSTRAC reporting
        </div>
        <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
          Compliance reports
        </h1>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '13px',
            background: colors.cardBg,
            color: colors.ink,
          }}
        >
          {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div style={{ background: colors.cardBg, borderRadius: radius.card, boxShadow: shadow.card, overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead style={{ background: colors.pageBg, borderBottom: `1px solid ${colors.border}` }}>
              <tr>
                <Th>ID</Th>
                <Th>Type</Th>
                <Th>Transfer</Th>
                <Th>User</Th>
                <Th>AUSTRAC ref</Th>
                <Th>Reported</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r, i) => {
                const tone = TYPE_TONE[r.type] ?? { bg: 'rgba(136,136,136,0.15)', fg: colors.muted }
                return (
                  <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }} className="hover:bg-[#fafafa] transition-colors">
                    <td className="px-4 py-3 font-mono" style={{ color: colors.ink, fontSize: '12px' }}>{r.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3">
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: tone.bg,
                          color: tone.fg,
                        }}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: colors.muted, fontSize: '12px' }}>
                      {r.transferId ? `${r.transferId.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: colors.muted, fontSize: '12px' }}>
                      {r.userId ? `${r.userId.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="px-4 py-3" style={{ color: colors.ink }}>{r.austracRef ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: colors.muted, fontSize: '12px' }}>
                      {r.reportedAt
                        ? new Date(r.reportedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                        : <span style={{ color: '#8a6d0a', fontWeight: 600 }}>Pending</span>}
                    </td>
                    <td className="px-4 py-3" style={{ color: colors.muted, fontSize: '12px' }}>
                      {new Date(r.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
              {!loading && reports.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center" style={{ color: colors.muted }}>
                    No compliance reports found
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
          onClick={() => fetchReports(nextCursor)}
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-4 py-2 text-left"
      style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.muted }}
    >
      {children}
    </th>
  )
}
