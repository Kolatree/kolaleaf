'use client'

import { useState, useEffect, useRef } from 'react'
import { DashboardShell, FieldLabel, colors, radius, shadow, spacing, type as typeT, GRADIENT } from '@/components/design/KolaPrimitives'

interface Recipient {
  id: string
  fullName: string
  bankName: string
  bankCode: string
  accountNumber: string
}

interface Bank {
  name: string
  code: string
}

type ResolveState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'resolved'; accountName: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable' }

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
  background: colors.cardBg,
  color: colors.ink,
}

const RESOLVE_DEBOUNCE_MS = 400

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [banks, setBanks] = useState<Bank[]>([])
  const [banksError, setBanksError] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [resolveState, setResolveState] = useState<ResolveState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolveSeqRef = useRef(0)

  const selectedBank = banks.find((b) => b.code === bankCode)

  useEffect(() => {
    loadRecipients()
    loadBanks()
  }, [])

  useEffect(() => {
    // Debounced pre-flight resolve. Fires when bank + 10-digit number are
    // present; resets on any change so the UI always reflects the latest
    // input. `resolveSeqRef` guards against out-of-order responses racing.
    if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current)

    if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
      setResolveState({ kind: 'idle' })
      return
    }

    setResolveState({ kind: 'loading' })
    const seq = ++resolveSeqRef.current
    resolveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/recipients/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bankCode, accountNumber }),
        })
        if (seq !== resolveSeqRef.current) return
        if (res.ok) {
          const data = await res.json()
          setResolveState({ kind: 'resolved', accountName: String(data.accountName ?? '') })
        } else if (res.status === 404) {
          setResolveState({ kind: 'not_found' })
        } else {
          setResolveState({ kind: 'unavailable' })
        }
      } catch {
        if (seq !== resolveSeqRef.current) return
        setResolveState({ kind: 'unavailable' })
      }
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current)
    }
  }, [bankCode, accountNumber])

  async function loadBanks() {
    try {
      const res = await fetch('/api/banks?country=NG')
      if (res.ok) {
        const data = await res.json()
        setBanks(Array.isArray(data.banks) ? data.banks : [])
      } else {
        setBanksError('Unable to load bank list. Refresh to try again.')
      }
    } catch {
      setBanksError('Unable to load bank list. Refresh to try again.')
    }
  }

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
    if (resolveState.kind !== 'resolved' || !selectedBank) {
      setError('Verify the account first.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: resolveState.accountName,
          bankName: selectedBank.name,
          bankCode: selectedBank.code,
          accountNumber,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add recipient')
        return
      }
      setRecipients((prev) => [data.recipient, ...prev])
      setBankCode('')
      setAccountNumber('')
      setResolveState({ kind: 'idle' })
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
              {banksError && (
                <div role="alert" className="md:col-span-2" style={{ background: '#fef1f2', color: '#b00020', fontSize: '13px', padding: '10px 12px', borderRadius: '8px' }}>
                  {banksError}
                </div>
              )}
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <FieldLabel>Bank</FieldLabel>
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  required
                  style={inputStyle}
                >
                  <option value="" disabled>
                    {banks.length === 0 ? 'Loading banks…' : 'Select a bank'}
                  </option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <FieldLabel>Account number</FieldLabel>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  maxLength={10}
                  placeholder="0234567891"
                  style={inputStyle}
                />
                <span style={{ fontSize: '12px', color: colors.muted }}>
                  10-digit account number (for mobile-money wallets, use your 10-digit wallet account).
                </span>
              </label>
              <div className="md:col-span-2" aria-live="polite" style={{ minHeight: '44px' }}>
                {resolveState.kind === 'loading' && (
                  <p style={{ fontSize: '13px', color: colors.muted }}>Looking up account…</p>
                )}
                {resolveState.kind === 'resolved' && (
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: colors.ink }}>
                      ✓ {resolveState.accountName}
                    </p>
                    <p style={{ fontSize: '12px', color: colors.muted }}>
                      This is your recipient&apos;s registered name with the bank.
                    </p>
                  </div>
                )}
                {resolveState.kind === 'not_found' && (
                  <p role="alert" style={{ fontSize: '13px', color: '#b00020' }}>
                    Account not found. Check the account number and bank.
                  </p>
                )}
                {resolveState.kind === 'unavailable' && (
                  <p role="alert" style={{ fontSize: '13px', color: '#c2410c' }}>
                    Unable to verify right now. Try again.
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={saving || resolveState.kind !== 'resolved'}
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
