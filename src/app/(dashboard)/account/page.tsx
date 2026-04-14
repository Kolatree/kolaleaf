'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface KycStatus {
  status: string
  applicantId?: string
}

const KYC_LABELS: Record<string, { text: string; color: string }> = {
  VERIFIED: { text: 'Verified', color: 'bg-green-100 text-green-700' },
  PENDING: { text: 'Not Started', color: 'bg-gray-100 text-gray-600' },
  IN_REVIEW: { text: 'In Review', color: 'bg-yellow-100 text-yellow-700' },
  REJECTED: { text: 'Rejected', color: 'bg-red-100 text-red-600' },
}

export default function AccountPage() {
  const router = useRouter()
  const [kyc, setKyc] = useState<KycStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/kyc/status')
        if (res.ok) {
          const data = await res.json()
          setKyc(data)
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Proceed even if logout API fails
    }
    router.push('/login')
  }

  async function handleInitiateKyc() {
    try {
      const res = await fetch('/api/kyc/initiate', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.verificationUrl) {
          window.location.href = data.verificationUrl
        }
      }
    } catch {
      // Silent fail
    }
  }

  const kycLabel = kyc ? KYC_LABELS[kyc.status] ?? KYC_LABELS.PENDING : null

  return (
    <>
      <header className="px-6 pt-4 pb-4 text-white">
        <h1 className="text-xl font-bold">Account</h1>
      </header>

      <main className="px-4 space-y-4">
        {/* KYC Status */}
        <div className="bg-white rounded-2xl p-5 shadow-lg">
          <h2 className="font-semibold mb-3">Identity Verification</h2>
          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <span className={`inline-block text-[12px] font-semibold px-3 py-1 rounded-full ${kycLabel?.color}`}>
                  {kycLabel?.text}
                </span>
              </div>
              {kyc && (kyc.status === 'PENDING' || kyc.status === 'REJECTED') && (
                <button
                  onClick={handleInitiateKyc}
                  className="text-sm font-medium text-kolaleaf-purple"
                >
                  {kyc.status === 'REJECTED' ? 'Retry Verification' : 'Start Verification'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Security */}
        <div className="bg-white rounded-2xl p-5 shadow-lg">
          <h2 className="font-semibold mb-3">Security</h2>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-gray-600">Two-Factor Authentication</span>
            <span className="text-[12px] font-semibold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
              Manage in app
            </span>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full bg-white rounded-2xl p-4 shadow-lg text-center text-red-500 font-semibold disabled:opacity-50"
        >
          {loggingOut ? 'Signing out...' : 'Sign Out'}
        </button>
      </main>
    </>
  )
}
