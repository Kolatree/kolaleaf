'use client'

import { useState, useEffect, useCallback } from 'react'

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
      if (cursor) {
        setReports((prev) => [...prev, ...data.reports])
      } else {
        setReports(data.reports)
      }
      setNextCursor(data.nextCursor)
    }
    setLoading(false)
  }, [type])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Compliance Reports</h1>

      <div className="flex gap-3 mb-4">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
        >
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">ID</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Type</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Transfer</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">User</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">AUSTRAC Ref</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Reported</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reports.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{r.id.slice(0, 8)}...</td>
                <td className="px-4 py-2">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                    {r.type}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {r.transferId ? `${r.transferId.slice(0, 8)}...` : '-'}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {r.userId ? `${r.userId.slice(0, 8)}...` : '-'}
                </td>
                <td className="px-4 py-2 text-xs">{r.austracRef ?? '-'}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {r.reportedAt ? new Date(r.reportedAt).toLocaleDateString() : 'Pending'}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!loading && reports.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No compliance reports found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <button
          onClick={() => fetchReports(nextCursor)}
          disabled={loading}
          className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}
