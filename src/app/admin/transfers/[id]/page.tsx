'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'

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
    const res = await fetch(`/api/admin/transfers/${id}`)
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
  }, [id])

  async function handleRetry() {
    setActionLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/transfers/${id}/retry`, { method: 'POST' })
    if (res.ok) {
      await fetchTransfer()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Retry failed')
    }
    setActionLoading(false)
  }

  async function handleRefund() {
    setActionLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/transfers/${id}/refund`, { method: 'POST' })
    if (res.ok) {
      await fetchTransfer()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Refund failed')
    }
    setActionLoading(false)
  }

  if (!transfer && !error) {
    return <p className="text-gray-500">Loading...</p>
  }

  if (error && !transfer) {
    return <p className="text-red-600">{error}</p>
  }

  if (!transfer) return null

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/transfers" className="text-sm text-blue-600 hover:underline">
          &larr; Back to transfers
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        Transfer {transfer.id.slice(0, 8)}...
      </h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Transfer info */}
      <div className="bg-white border border-gray-200 rounded p-4 mb-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Status" value={transfer.status.replace(/_/g, ' ')} />
          <Field label="Sender" value={transfer.user.fullName} />
          <Field label="Recipient" value={`${transfer.recipient.fullName} (${transfer.recipient.bankName})`} />
          <Field label="Send" value={`${Number(transfer.sendAmount).toLocaleString()} ${transfer.sendCurrency}`} />
          <Field label="Receive" value={`${Number(transfer.receiveAmount).toLocaleString()} ${transfer.receiveCurrency}`} />
          <Field label="Exchange Rate" value={transfer.exchangeRate} />
          <Field label="Fee" value={`${Number(transfer.fee).toLocaleString()} ${transfer.sendCurrency}`} />
          <Field label="PayID Ref" value={transfer.payidReference ?? '-'} />
          <Field label="Payout Provider" value={transfer.payoutProvider ?? '-'} />
          <Field label="Payout Ref" value={transfer.payoutProviderRef ?? '-'} />
          <Field label="Retry Count" value={String(transfer.retryCount)} />
          <Field label="Failure Reason" value={transfer.failureReason ?? '-'} />
          <Field label="Created" value={new Date(transfer.createdAt).toLocaleString()} />
          <Field label="Completed" value={transfer.completedAt ? new Date(transfer.completedAt).toLocaleString() : '-'} />
        </div>
      </div>

      {/* Actions for NEEDS_MANUAL */}
      {transfer.status === 'NEEDS_MANUAL' && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleRetry}
            disabled={actionLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {actionLoading ? 'Processing...' : 'Retry Payout'}
          </button>
          <button
            onClick={handleRefund}
            disabled={actionLoading}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
          >
            {actionLoading ? 'Processing...' : 'Refund'}
          </button>
        </div>
      )}

      {/* Event timeline */}
      {transfer.events.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-3">Event Timeline</h2>
          <div className="border-l-2 border-gray-200 ml-3 space-y-4">
            {transfer.events.map((event) => (
              <div key={event.id} className="pl-4 relative">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-gray-300 border-2 border-white" />
                <p className="text-sm font-medium text-gray-900">
                  {event.fromStatus.replace(/_/g, ' ')} &rarr; {event.toStatus.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-gray-500">
                  {event.actor}{event.actorId ? ` (${event.actorId.slice(0, 8)})` : ''} &mdash;{' '}
                  {new Date(event.createdAt).toLocaleString()}
                </p>
                {event.metadata && (
                  <pre className="text-xs text-gray-400 mt-1">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-gray-900">{value}</p>
    </div>
  )
}
