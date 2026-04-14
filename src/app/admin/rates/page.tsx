'use client'

import { useState, useEffect } from 'react'

interface RateEntry {
  id: string
  wholesaleRate: string
  spread: string
  customerRate: string
  effectiveAt: string
  adminOverride: boolean
  setById: string | null
}

interface CorridorRate {
  corridor: { id: string; baseCurrency: string; targetCurrency: string }
  currentRate: RateEntry | null
  stale: boolean
  hoursStale?: number
  history: RateEntry[]
}

export default function AdminRatesPage() {
  const [rates, setRates] = useState<CorridorRate[]>([])
  const [loading, setLoading] = useState(true)
  const [formCorridorId, setFormCorridorId] = useState('')
  const [formCustomerRate, setFormCustomerRate] = useState('')
  const [formWholesaleRate, setFormWholesaleRate] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  async function fetchRates() {
    setLoading(true)
    const res = await fetch('/api/admin/rates')
    if (res.ok) {
      const data = await res.json()
      setRates(data.rates ?? [])
      if (data.rates?.length > 0 && !formCorridorId) {
        setFormCorridorId(data.rates[0].corridor.id)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchRates()
  }, [])

  async function handleSetRate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitSuccess(false)

    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corridorId: formCorridorId,
        customerRate: formCustomerRate,
        wholesaleRate: formWholesaleRate,
      }),
    })

    if (res.ok) {
      setSubmitSuccess(true)
      setFormCustomerRate('')
      setFormWholesaleRate('')
      await fetchRates()
    } else {
      const data = await res.json()
      setSubmitError(data.error ?? 'Failed to set rate')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Exchange Rates</h1>

      {/* Current rates */}
      {rates.map((r) => (
        <div key={r.corridor.id} className="bg-white border border-gray-200 rounded p-4 mb-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-lg font-medium text-gray-900">
                {r.corridor.baseCurrency} / {r.corridor.targetCurrency}
              </h2>
              {r.stale && (
                <p className="text-xs text-yellow-600 font-medium">
                  Stale — {r.hoursStale ?? '?'}h since last update
                </p>
              )}
            </div>
            {r.currentRate && (
              <div className="text-right">
                <p className="text-2xl font-semibold text-gray-900">
                  {Number(r.currentRate.customerRate).toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">
                  Wholesale: {Number(r.currentRate.wholesaleRate).toFixed(4)} | Spread: {(Number(r.currentRate.spread) * 100).toFixed(2)}%
                  {r.currentRate.adminOverride && (
                    <span className="ml-2 text-blue-600 font-medium">Admin Override</span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Rate history */}
          {r.history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                Rate History ({r.history.length})
              </summary>
              <table className="w-full mt-2 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-2 py-1">Date</th>
                    <th className="text-right px-2 py-1">Customer Rate</th>
                    <th className="text-right px-2 py-1">Wholesale</th>
                    <th className="text-right px-2 py-1">Spread</th>
                    <th className="text-left px-2 py-1">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {r.history.map((h) => (
                    <tr key={h.id}>
                      <td className="px-2 py-1 text-gray-500">{new Date(h.effectiveAt).toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono">{Number(h.customerRate).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right font-mono">{Number(h.wholesaleRate).toFixed(4)}</td>
                      <td className="px-2 py-1 text-right">{(Number(h.spread) * 100).toFixed(2)}%</td>
                      <td className="px-2 py-1">{h.adminOverride ? 'Admin' : 'API'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      ))}

      {!loading && rates.length === 0 && (
        <p className="text-gray-500 text-sm mb-6">No corridors configured</p>
      )}

      {/* Set rate form */}
      <div className="bg-white border border-gray-200 rounded p-4 mt-6">
        <h2 className="text-lg font-medium text-gray-900 mb-3">Set Admin Rate Override</h2>
        <form onSubmit={handleSetRate} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Corridor</label>
            <select
              value={formCorridorId}
              onChange={(e) => setFormCorridorId(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
            >
              {rates.map((r) => (
                <option key={r.corridor.id} value={r.corridor.id}>
                  {r.corridor.baseCurrency}/{r.corridor.targetCurrency}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Wholesale Rate</label>
              <input
                type="text"
                value={formWholesaleRate}
                onChange={(e) => setFormWholesaleRate(e.target.value)}
                placeholder="e.g. 1050.00"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Customer Rate</label>
              <input
                type="text"
                value={formCustomerRate}
                onChange={(e) => setFormCustomerRate(e.target.value)}
                placeholder="e.g. 1020.00"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                required
              />
            </div>
          </div>
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          {submitSuccess && <p className="text-sm text-green-600">Rate updated successfully</p>}
          <button
            type="submit"
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-800"
          >
            Set Rate
          </button>
        </form>
      </div>
    </div>
  )
}
