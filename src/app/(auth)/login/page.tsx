'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needs2FA, setNeeds2FA] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      if (data.requires2FA) {
        setNeeds2FA(true)
        return
      }

      router.push('/send')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handle2FA(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: totpCode }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Verification failed')
        return
      }

      router.push('/send')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white">
          Kola<span className="text-kolaleaf-green-light">leaf</span>
        </h1>
        <p className="text-white/70 text-sm mt-1">Fast. Secure. Better rates to Nigeria.</p>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-lg">
        {!needs2FA ? (
          <form onSubmit={handleLogin}>
            <h2 className="text-xl font-semibold text-center mb-6">Sign In</h2>

            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>
            )}

            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              placeholder="you@example.com"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-6 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              placeholder="Enter your password"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handle2FA}>
            <h2 className="text-xl font-semibold text-center mb-2">Two-Factor Authentication</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              Enter the 6-digit code from your authenticator app.
            </p>

            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>
            )}

            <input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg mb-6 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
              placeholder="000000"
              autoFocus
            />

            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500 mt-4">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-kolaleaf-purple font-medium">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  )
}
