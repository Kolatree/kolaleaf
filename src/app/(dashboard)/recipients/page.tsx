'use client'

import { useState, useEffect } from 'react'

interface Recipient {
  id: string
  fullName: string
  bankName: string
  bankCode: string
  accountNumber: string
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
    <>
      <header className="px-6 pt-4 pb-4 text-white flex justify-between items-center">
        <h1 className="text-xl font-bold">Recipients</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm bg-white/20 px-3 py-1 rounded-full"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </header>

      <main className="px-4">
        {showForm && (
          <div className="bg-white rounded-2xl p-5 shadow-lg mb-4">
            <h2 className="font-semibold mb-4">Add Recipient</h2>
            {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-3">{error}</div>}
            <form onSubmit={handleAdd}>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Full name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              />
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                required
                placeholder="Bank name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              />
              <input
                type="text"
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                required
                placeholder="Bank code"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              />
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                required
                placeholder="Account number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Recipient'}
              </button>
            </form>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : recipients.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p className="font-medium text-gray-600 mb-1">No recipients yet</p>
              <p className="text-sm">Add a recipient to start sending money.</p>
            </div>
          ) : (
            <ul>
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-4 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-semibold text-[14px]">{r.fullName}</p>
                    <p className="text-[12px] text-gray-400">{r.bankName} &mdash; {r.accountNumber}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-red-400 text-[12px] hover:text-red-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}
