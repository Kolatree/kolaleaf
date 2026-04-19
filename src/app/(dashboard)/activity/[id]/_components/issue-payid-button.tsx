'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colors } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

export function IssuePayIdButton({ transferId }: { transferId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [needsKyc, setNeedsKyc] = useState(false)

  async function issuePayId() {
    setBusy(true)
    setErr(null)
    setNeedsKyc(false)

    try {
      const res = await apiFetch(`transfers/${transferId}/issue-payid`, {
        method: 'POST',
      })
      if (res.ok) {
        router.refresh()
        return
      }

      const data = await res.json().catch(() => ({ error: 'Unable to issue PayID' }))
      const message = typeof data.error === 'string' ? data.error : 'Unable to issue PayID'
      if (res.status === 403 && /kyc/i.test(message)) {
        setNeedsKyc(true)
      }
      setErr(message)
    } catch {
      setErr('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={issuePayId}
        disabled={busy}
        style={{
          padding: '10px 16px',
          borderRadius: '10px',
          background: colors.purple,
          border: `1px solid ${colors.purple}`,
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {busy ? 'Issuing…' : 'Get PayID instructions'}
      </button>
      {err && (
        <div className="mt-2" style={{ fontSize: '12px', color: '#b00020' }}>
          {err}
        </div>
      )}
      {needsKyc && (
        <div className="mt-2" style={{ fontSize: '12px', color: colors.muted }}>
          Complete identity verification in{' '}
          <Link href="/account" style={{ color: colors.purple, fontWeight: 600 }}>
            Account
          </Link>{' '}
          to unlock AUD payment instructions.
        </div>
      )}
    </div>
  )
}
