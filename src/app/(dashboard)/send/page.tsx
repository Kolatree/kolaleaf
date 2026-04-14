'use client'

import { useState, useEffect, useCallback } from 'react'
import Decimal from 'decimal.js'

interface Recipient {
  id: string
  fullName: string
  bankName: string
  accountNumber: string
}

interface RateData {
  corridorId: string
  customerRate: string
  effectiveAt: string
}

function formatAUD(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatNGN(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return '0'
  return Math.floor(num).toLocaleString('en-NG')
}

export default function SendPage() {
  const [sendAmount, setSendAmount] = useState('1000')
  const [rate, setRate] = useState<RateData | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedRecipientId, setSelectedRecipientId] = useState('')
  const [kycVerified, setKycVerified] = useState<boolean | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fetchRate = useCallback(async () => {
    try {
      const res = await fetch('/api/rates/aud-ngn')
      if (res.ok) {
        const data = await res.json()
        setRate(data)
      }
    } catch {
      // Rate fetch failed silently — will show "Loading..." state
    }
  }, [])

  useEffect(() => {
    fetchRate()
    const interval = setInterval(fetchRate, 60_000)
    return () => clearInterval(interval)
  }, [fetchRate])

  useEffect(() => {
    async function load() {
      try {
        const [recipientsRes, kycRes] = await Promise.all([
          fetch('/api/recipients'),
          fetch('/api/kyc/status'),
        ])
        if (recipientsRes.ok) {
          const data = await recipientsRes.json()
          setRecipients(data.recipients)
          if (data.recipients.length > 0) {
            setSelectedRecipientId(data.recipients[0].id)
          }
        }
        if (kycRes.ok) {
          const data = await kycRes.json()
          setKycVerified(data.status === 'VERIFIED')
        }
      } catch {
        // Silent fail on initial load
      }
    }
    load()
  }, [])

  const receiveAmount = rate && sendAmount
    ? new Decimal(sendAmount || '0').mul(new Decimal(rate.customerRate)).toFixed(0)
    : '0'

  async function handleSend() {
    if (!selectedRecipientId || !rate) return
    setError('')
    setSuccess('')
    setSending(true)

    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientId: selectedRecipientId,
          corridorId: rate.corridorId,
          sendAmount,
          exchangeRate: rate.customerRate,
          fee: '0',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Transfer failed')
        return
      }
      setSuccess('Transfer created! Check Activity for status.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <header className="px-6 pt-4 pb-2 text-white">
        <h1 className="text-[22px] font-bold tracking-tight">
          Kola<span className="text-kolaleaf-green-light">leaf</span>
        </h1>
        <p className="text-[13px] text-white/70">Fast. Secure. Better rates to Nigeria.</p>
      </header>

      <main className="px-4">
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          {/* You Send */}
          <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">You send</p>
          <div className="flex items-center justify-between mb-5">
            <input
              type="text"
              inputMode="decimal"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="text-4xl font-bold text-foreground w-[60%] border-none outline-none bg-transparent"
              placeholder="0"
            />
            <div className="flex items-center gap-1.5 bg-gray-100 px-3 py-1.5 rounded-full text-[13px] font-semibold">
              <span className="w-5 h-3.5 rounded-sm bg-gradient-to-b from-blue-900 via-white to-red-600 inline-block" />
              AUD
            </div>
          </div>

          {/* Rate bar */}
          <div className="bg-kolaleaf-bg rounded-lg px-3.5 py-2.5 text-center text-[13px] text-kolaleaf-green font-semibold mb-5">
            <span className="text-gray-400 font-normal">Best Rate</span>
            &nbsp; 1 AUD = {rate ? formatNGN(rate.customerRate) : '...'} NGN
          </div>

          {/* They Receive */}
          <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">They receive</p>
          <div className="flex items-center justify-between mb-5">
            <span className="text-4xl font-bold text-kolaleaf-green">{formatNGN(receiveAmount)}</span>
            <div className="flex items-center gap-1.5 bg-gray-100 px-3 py-1.5 rounded-full text-[13px] font-semibold">
              <span className="w-5 h-3.5 rounded-sm inline-block" style={{ background: 'linear-gradient(90deg, #008751 33%, #fff 33% 66%, #008751 66%)' }} />
              NGN
            </div>
          </div>

          <hr className="border-gray-100 mb-5" />

          {/* Recipient selector */}
          {recipients.length > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-[14px] mb-2">
                <span className="text-gray-400">Recipient</span>
                <select
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  className="font-semibold text-right bg-transparent border-none outline-none cursor-pointer"
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>{r.fullName} — {r.bankName}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Details */}
          <div className="flex justify-between text-[14px] mb-3.5">
            <span className="text-gray-400">Receive method</span>
            <span className="font-semibold">Bank Transfer</span>
          </div>
          <div className="flex justify-between text-[14px] mb-3.5">
            <span className="text-gray-400">Fee</span>
            <span className="font-semibold text-kolaleaf-green">0 AUD</span>
          </div>
          <div className="flex justify-between text-[14px] mb-3.5">
            <span className="text-gray-400">Transfer time</span>
            <span className="font-semibold text-kolaleaf-green">Minutes</span>
          </div>
          <div className="flex justify-between text-[14px] mb-4">
            <span className="text-gray-400">Total to pay</span>
            <span className="font-bold text-kolaleaf-purple">{formatAUD(sendAmount)} AUD</span>
          </div>

          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>}
          {success && <div className="bg-green-50 text-kolaleaf-green text-sm p-3 rounded-lg mb-4">{success}</div>}

          {/* CTA */}
          {kycVerified === false ? (
            <a
              href="/account"
              className="block w-full py-4 rounded-xl font-bold text-white text-center bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green"
            >
              Complete Verification
            </a>
          ) : (
            <button
              onClick={handleSend}
              disabled={sending || !rate || !selectedRecipientId || !sendAmount}
              className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Money'}
            </button>
          )}
        </div>

        {/* Trust bar */}
        <div className="flex justify-between items-center px-2 py-3 mt-4 text-[11px] text-white/70">
          <div className="text-center">
            <div className="font-semibold text-white">AUSTRAC</div>
            Registered
          </div>
          <div className="text-center">
            <div className="font-semibold text-white">Minutes</div>
            Delivery
          </div>
          <div className="text-center">
            <div className="font-semibold text-white">4.8/5</div>
            Trust Score
          </div>
        </div>
      </main>
    </>
  )
}
