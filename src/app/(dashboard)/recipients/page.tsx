'use client'

import { useState, useEffect } from 'react'
import { DashboardShell, FieldLabel, colors, radius, shadow, spacing, type as typeT, GRADIENT } from '@/components/design/KolaPrimitives'

interface Recipient {
  id: string
  fullName: string
  bankName: string
  bankCode: string
  accountNumber: string
}

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
  background: colors.cardBg,
  color: colors.ink,
}

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadRecipients()
  }, [])

  async function loadRecipients() {
    try {
      const res = await fetch('/api/recipients')
      if (res.ok) {
        const data = await res.json()
        setRecipients(data.recipients)
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, bankName, bankCode, accountNumber }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add recipient')
        return
      }
      setRecipients((prev) => [data.recipient, ...prev])
      setFullName('')
      setBankName('')
      setBankCode('')
      setAccountNumber('')
      setShowForm(false)
    } catch {
      setError('Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/recipients/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRecipients((prev) => prev.filter((r) => r.id !== id))
      }
    } catch {
      // Silent fail
    }
  }

  return (
    <DashboardShell active="Recipients">
      <div className="max-w-[900px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              People you send to
            </div>
            <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
              Recipients
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="text-white transition hover:brightness-110"
            style={{
              background: GRADIENT,
              padding: '10px 18px',
              borderRadius: radius.cta,
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            {showForm ? 'Cancel' : '+ Add recipient'}
          </button>
        </div>

        {showForm && (
          <div
            className="mb-4 kola-card-enter"
            style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}
          >
            <h2 className="mb-4" style={{ fontSize: '16px', fontWeight: 600, color: colors.ink }}>New recipient</h2>
            {error && (
              <div role="alert" className="mb-3" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
                {error}
              </div>
            )}
            <form onSubmit={handleAdd} className="grid md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <FieldLabel>Full name</FieldLabel>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Chinwe Obimma" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5">
                <FieldLabel>Bank name</FieldLabel>
                <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} required placeholder="GTBank" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5">
                <FieldLabel>Bank code</FieldLabel>
                <input type="text" value={bankCode} onChange={(e) => setBankCode(e.target.value)} required placeholder="058" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <FieldLabel>Account number</FieldLabel>
                <input type="text" inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required placeholder="0234567891" style={inputStyle} />
              </label>
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                className="md:col-span-2 w-full text-white transition hover:brightness-110 disabled:opacity-60"
                style={{
                  background: GRADIENT,
                  padding: spacing.ctaPad,
                  borderRadius: radius.cta,
                  fontSize: typeT.cta.size,
                  fontWeight: typeT.cta.weight,
                  letterSpacing: typeT.cta.letterSpacing,
                  marginTop: '4px',
                }}
              >
                {saving ? 'Adding…' : 'Add recipient'}
              </button>
            </form>
          </div>
        )}

        <div style={{ background: colors.cardBg, borderRadius: radius.card, boxShadow: shadow.card, overflow: 'hidden' }}>
          {loading ? (
            <div className="p-10 text-center" style={{ color: colors.muted, fontSize: '14px' }}>Loading…</div>
          ) : recipients.length === 0 ? (
            <div className="p-10 text-center">
              <p style={{ fontWeight: 600, color: colors.ink }}>No recipients yet</p>
              <p className="mt-1" style={{ fontSize: '13px', color: colors.muted }}>Add a recipient to start sending money.</p>
            </div>
          ) : (
            <ul className="kola-stagger">
              {recipients.map((r, i) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between px-5 py-4"
                  style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="grid place-items-center shrink-0"
                      style={{ width: '40px', height: '40px', borderRadius: '20px', background: GRADIENT, color: '#fff', fontSize: '12px', fontWeight: 700 }}
                    >
                      {r.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate" style={{ fontWeight: 600, fontSize: '14px', color: colors.ink }}>{r.fullName}</p>
                      <p className="truncate" style={{ fontSize: '12px', color: colors.muted }}>
                        {r.bankName} · •••{r.accountNumber.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="shrink-0"
                    style={{ fontSize: '12px', fontWeight: 600, color: '#b00020' }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
