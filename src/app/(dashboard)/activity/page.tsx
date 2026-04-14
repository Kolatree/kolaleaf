'use client'

import { useState, useEffect } from 'react'

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

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  CREATED: 'bg-gray-100 text-gray-600',
  AWAITING_AUD: 'bg-yellow-100 text-yellow-700',
  AUD_RECEIVED: 'bg-blue-100 text-blue-700',
  PROCESSING_NGN: 'bg-blue-100 text-blue-700',
  NGN_SENT: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
  EXPIRED: 'bg-gray-100 text-gray-500',
  NGN_FAILED: 'bg-red-100 text-red-600',
  NGN_RETRY: 'bg-yellow-100 text-yellow-700',
  NEEDS_MANUAL: 'bg-orange-100 text-orange-600',
  REFUNDED: 'bg-purple-100 text-purple-600',
  FLOAT_INSUFFICIENT: 'bg-yellow-100 text-yellow-700',
}

function formatAmount(amount: string, currency: string): string {
  const num = parseFloat(amount)
  if (currency === 'NGN') return Math.floor(num).toLocaleString('en-NG') + ' NGN'
  return num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' AUD'
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

export default function ActivityPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/transfers')
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
    <>
      <header className="px-6 pt-4 pb-4 text-white">
        <h1 className="text-xl font-bold">Activity</h1>
      </header>

      <main className="px-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : transfers.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p className="font-medium text-gray-600 mb-1">No transfers yet</p>
              <p className="text-sm">Your transfer history will appear here.</p>
            </div>
          ) : (
            <ul>
              {transfers.map((t) => (
                <li key={t.id} className="border-b border-gray-50 last:border-0">
                  <a href={`/activity/${t.id}`} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <p className="font-semibold text-[14px]">{formatAmount(t.sendAmount, t.sendCurrency)}</p>
                      <p className="text-[12px] text-gray-400">{formatDate(t.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-medium text-kolaleaf-green">{formatAmount(t.receiveAmount, t.receiveCurrency)}</p>
                      <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel(t.status)}
                      </span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}
