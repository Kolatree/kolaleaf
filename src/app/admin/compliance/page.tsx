'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { AdminShell, colors, radius, shadow } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

const REPORT_TYPES = ['ALL', 'THRESHOLD', 'SUSPICIOUS', 'IFTI']
const REPORT_STATUSES = ['ALL', 'PENDING', 'REPORTED']

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
  const [status, setStatus] = useState('PENDING')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftRefs, setDraftRefs] = useState<Record<string, string>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const fetchReports = useCallback(async (cursor?: string) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (type !== 'ALL') params.set('type', type)
    if (status !== 'ALL') params.set('status', status)
    if (cursor) params.set('cursor', cursor)

    const res = await apiFetch(`admin/compliance?${params}`)
    if (res.ok) {
      const data = await res.json()
      if (cursor) setReports((prev) => [...prev, ...data.reports])
      else setReports(data.reports)
      setNextCursor(data.nextCursor)
    } else {
      const data = await res.json().catch(() => ({ error: 'Failed to load reports' }))
      setError(typeof data.error === 'string' ? data.error : 'Failed to load reports')
    }
    setLoading(false)
  }, [status, type])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  async function markReported(reportId: string) {
    const austracRef = draftRefs[reportId]?.trim()
    if (!austracRef) {
      setError('Enter the AUSTRAC reference before marking a report filed.')
      return
    }

    setSubmittingId(reportId)
    setError(null)
    try {
      const res = await apiFetch(`admin/compliance/${reportId}/mark-reported`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ austracRef }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to mark reported' }))
        setError(typeof data.error === 'string' ? data.error : 'Failed to mark reported')
        return
      }
      const updated = await res.json()
      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId
            ? {
                ...report,
                austracRef: updated.austracRef,
                reportedAt: updated.reportedAt,
              }
            : report,
        ),
      )
    } finally {
      setSubmittingId(null)
    }
  }

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

      <div className="flex gap-3 mb-4 flex-wrap">
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
          {REPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4"
          style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}
        >
          {error}
        </div>
      )}

      <div style={{ background: colors.cardBg, borderRadius: radius.card, boxShadow: shadow.card, overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead style={{ background: colors.pageBg, borderBottom: `1px solid ${colors.border}` }}>
              <tr>
                <Th>ID</Th>
                <Th>Type</Th>
                <Th>Details</Th>
                <Th>Transfer</Th>
                <Th>User</Th>
                <Th>AUSTRAC ref</Th>
                <Th>Reported</Th>
                <Th>Created</Th>
                <Th>Action</Th>
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
                    <td className="px-4 py-3" style={{ color: colors.ink, fontSize: '12px', maxWidth: '240px' }}>
                      {summarizeDetails(r.details)}
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ fontSize: '12px' }}>
                      {r.transferId ? (
                        <Link href={`/admin/transfers/${r.transferId}`} style={{ color: colors.purple }}>
                          {r.transferId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span style={{ color: colors.muted }}>—</span>
                      )}
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
                    <td className="px-4 py-3">
                      {r.reportedAt ? (
                        <span style={{ color: colors.green, fontWeight: 600 }}>Filed</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={draftRefs[r.id] ?? ''}
                            onChange={(e) => setDraftRefs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            placeholder="AUSTRAC ref"
                            style={{
                              minWidth: '160px',
                              border: `1px solid ${colors.border}`,
                              borderRadius: '8px',
                              padding: '8px 10px',
                              fontSize: '12px',
                              background: colors.cardBg,
                              color: colors.ink,
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => markReported(r.id)}
                            disabled={submittingId === r.id}
                            style={{
                              borderRadius: '8px',
                              padding: '8px 10px',
                              fontSize: '12px',
                              fontWeight: 600,
                              background: colors.purple,
                              color: '#fff',
                              opacity: submittingId === r.id ? 0.6 : 1,
                            }}
                          >
                            {submittingId === r.id ? 'Saving…' : 'Mark filed'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!loading && reports.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center" style={{ color: colors.muted }}>
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

function summarizeDetails(details: Record<string, unknown>) {
  const reason = typeof details.reason === 'string' ? details.reason : null
  const source = typeof details.source === 'string' ? details.source : null
  const corridor = typeof details.corridor === 'string' ? details.corridor : null
  return [reason, source, corridor].filter(Boolean).join(' · ') || '—'
}
