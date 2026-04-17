'use client'

import { useState, useEffect } from 'react'
import { AdminShell, FieldLabel, colors, radius, shadow, spacing, GRADIENT } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

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

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '13px',
  background: colors.cardBg,
  color: colors.ink,
  outline: 'none',
  width: '100%',
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
    const res = await apiFetch('admin/rates')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSetRate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitSuccess(false)

    const res = await apiFetch('admin/rates', {
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
    <AdminShell active="Rates">
      <div className="mb-6">
        <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Pricing
        </div>
        <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
          Exchange rates
        </h1>
      </div>

      {rates.map((r) => (
        <section
          key={r.corridor.id}
          className="mb-4"
          style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>
                {r.corridor.baseCurrency} / {r.corridor.targetCurrency}
              </h2>
              {r.stale && (
                <span
                  className="inline-block mt-1"
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(255,215,0,0.20)',
                    color: '#8a6d0a',
                  }}
                >
                  Stale · {r.hoursStale ?? '?'}h
                </span>
              )}
            </div>
            {r.currentRate && (
              <div className="text-right">
                <div className="tabular-nums" style={{ fontSize: '28px', fontWeight: 700, color: colors.ink }}>
                  {Number(r.currentRate.customerRate).toFixed(2)}
                </div>
                <div style={{ fontSize: '11px', color: colors.muted }}>
                  Wholesale {Number(r.currentRate.wholesaleRate).toFixed(4)} · spread {(Number(r.currentRate.spread) * 100).toFixed(2)}%
                  {r.currentRate.adminOverride && (
                    <span className="ml-2" style={{ color: colors.purple, fontWeight: 600 }}>Admin override</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {r.history.length > 0 && (
            <details className="mt-4">
              <summary style={{ fontSize: '13px', color: colors.muted, cursor: 'pointer', fontWeight: 600 }}>
                Rate history ({r.history.length})
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full" style={{ fontSize: '12px' }}>
                  <thead style={{ background: colors.pageBg }}>
                    <tr>
                      <Th>Date</Th>
                      <Th align="right">Customer</Th>
                      <Th align="right">Wholesale</Th>
                      <Th align="right">Spread</Th>
                      <Th>Source</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.history.map((h, i) => (
                      <tr key={h.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
                        <td className="px-3 py-2" style={{ color: colors.muted }}>{new Date(h.effectiveAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: colors.ink }}>{Number(h.customerRate).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: colors.ink }}>{Number(h.wholesaleRate).toFixed(4)}</td>
                        <td className="px-3 py-2 text-right" style={{ color: colors.ink }}>{(Number(h.spread) * 100).toFixed(2)}%</td>
                        <td className="px-3 py-2" style={{ color: h.adminOverride ? colors.purple : colors.muted }}>
                          {h.adminOverride ? 'Admin' : 'API'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      ))}

      {!loading && rates.length === 0 && (
        <p style={{ fontSize: '13px', color: colors.muted }}>No corridors configured.</p>
      )}

      {/* Override form */}
      <section
        className="mt-6"
        style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
      >
        <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Set admin rate override</h2>
        <form onSubmit={handleSetRate} className="mt-4 grid md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5 md:col-span-1">
            <FieldLabel>Corridor</FieldLabel>
            <select value={formCorridorId} onChange={(e) => setFormCorridorId(e.target.value)} style={inputStyle}>
              {rates.map((r) => (
                <option key={r.corridor.id} value={r.corridor.id}>
                  {r.corridor.baseCurrency}/{r.corridor.targetCurrency}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Wholesale rate</FieldLabel>
            <input type="text" value={formWholesaleRate} onChange={(e) => setFormWholesaleRate(e.target.value)} placeholder="1050.00" required style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Customer rate</FieldLabel>
            <input type="text" value={formCustomerRate} onChange={(e) => setFormCustomerRate(e.target.value)} placeholder="1020.00" required style={inputStyle} />
          </label>

          <div className="md:col-span-3">
            {submitError && (
              <p role="alert" style={{ fontSize: '13px', color: '#b00020', marginBottom: '8px' }}>{submitError}</p>
            )}
            {submitSuccess && (
              <p style={{ fontSize: '13px', color: colors.green, marginBottom: '8px' }}>Rate updated successfully.</p>
            )}
            <button
              type="submit"
              className="text-white transition hover:brightness-110"
              style={{ background: GRADIENT, padding: '10px 18px', borderRadius: '8px', fontSize: '14px', fontWeight: 600 }}
            >
              Set rate
            </button>
          </div>
        </form>
      </section>
    </AdminShell>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.muted }}
    >
      {children}
    </th>
  )
}
