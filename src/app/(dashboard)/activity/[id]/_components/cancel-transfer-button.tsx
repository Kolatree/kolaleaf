'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colors } from '@/components/design/KolaPrimitives'

export function CancelTransferButton({ transferId }: { transferId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function cancel() {
    if (!confirm('Cancel this transfer? This cannot be undone.')) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/transfers/${transferId}/cancel`, {
        method: 'POST',
      })
      if (res.ok) {
        // Refresh the server component so the status pill updates in-place.
        router.refresh()
        return
      }
      const data = await res.json().catch(() => ({ error: 'unknown' }))
      setErr(typeof data.error === 'string' ? data.error : 'Unable to cancel')
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
        onClick={cancel}
        disabled={busy}
        style={{
          padding: '10px 16px',
          borderRadius: '10px',
          background: 'transparent',
          border: `1px solid #b00020`,
          color: '#b00020',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {busy ? 'Cancelling…' : 'Cancel transfer'}
      </button>
      {err && (
        <div
          className="mt-2"
          style={{ fontSize: '12px', color: '#b00020' }}
        >
          {err}
        </div>
      )}
    </div>
  )
}
