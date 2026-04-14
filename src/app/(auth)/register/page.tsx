'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password,
          referralCode: referralCode || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Registration failed')
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
        <form onSubmit={handleRegister}>
          <h2 className="text-xl font-semibold text-center mb-6">Create Account</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>
          )}

          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
            placeholder="John Doe"
          />

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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
            placeholder="At least 8 characters"
          />

          <label className="block text-sm font-medium text-gray-700 mb-1">
            Referral Code <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-6 focus:outline-none focus:ring-2 focus:ring-kolaleaf-purple"
            placeholder="Enter referral code"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-kolaleaf-purple to-kolaleaf-green disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-kolaleaf-purple font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}
