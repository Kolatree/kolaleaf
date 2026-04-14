'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const STATUSES = [
  'ALL',
  'CREATED',
  'AWAITING_AUD',
  'AUD_RECEIVED',
  'PROCESSING_NGN',
  'NGN_SENT',
  'COMPLETED',
  'NGN_FAILED',
  'NGN_RETRY',
  'NEEDS_MANUAL',
  'REFUNDED',
  'CANCELLED',
  'EXPIRED',
  'FLOAT_INSUFFICIENT',
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

    const res = await fetch(`/api/admin/transfers?${params}`)
    if (res.ok) {
      const data = await res.json()
      if (cursor) {
        setTransfers((prev) => [...prev, ...data.transfers])
      } else {
        setTransfers(data.transfers)
      }
      setNextCursor(data.nextCursor)
    }
    setLoading(false)
  }, [status, search])

  useEffect(() => {
    fetchTransfers()
  }, [fetchTransfers])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Transfers</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search user or recipient..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchTransfers()}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm w-64"
        />
        <button
          onClick={() => fetchTransfers()}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">ID</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Sender</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Recipient</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Send</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Receive</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transfers.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link href={`/admin/transfers/${t.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                    {t.id.slice(0, 8)}...
                  </Link>
                </td>
                <td className="px-4 py-2">{t.user.fullName}</td>
                <td className="px-4 py-2">{t.recipient.fullName}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {Number(t.sendAmount).toLocaleString()} {t.sendCurrency}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {Number(t.receiveAmount).toLocaleString()} {t.receiveCurrency}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!loading && transfers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No transfers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {nextCursor && (
        <button
          onClick={() => fetchTransfers(nextCursor)}
          disabled={loading}
          className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800',
    NEEDS_MANUAL: 'bg-red-100 text-red-800',
    NGN_FAILED: 'bg-red-100 text-red-800',
    PROCESSING_NGN: 'bg-blue-100 text-blue-800',
    AWAITING_AUD: 'bg-yellow-100 text-yellow-800',
    REFUNDED: 'bg-purple-100 text-purple-800',
    CANCELLED: 'bg-gray-100 text-gray-600',
    EXPIRED: 'bg-gray-100 text-gray-600',
  }
  const colorClass = colors[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
