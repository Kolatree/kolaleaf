'use client'

import { useCallback, useEffect, useState } from 'react'
import { colors, radius, shadow, spacing } from '@/components/design/KolaPrimitives'
import { apiFetch } from '@/lib/http/api-client'

// Displays the user's name + primary email (with verified/unverified badge),
// any secondary email identifiers, and provides the entry points for the
// three self-service flows: change password, change email, remove email.
//
// Reads the extended /api/v1/account/me response added in 15g. All action
// dispatching is done inline to keep the surface contained; no global state.

type MeResponse = {
  userId: string
  fullName: string | null
  email: {
    id: string
    email: string
    verified: boolean
  } | null
  secondaryEmails: Array<{
    id: string
    email: string
    verified: boolean
  }>
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'change-password' }
  | { kind: 'change-email' }

const cardStyle = {
  background: colors.cardBg,
  borderRadius: radius.card,
  padding: spacing.cardPad,
  boxShadow: shadow.card,
}

const labelStyle = {
  fontSize: '11px',
  color: colors.muted,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: `1px solid ${colors.border}`,
  background: colors.pageBg,
  fontSize: '14px',
  color: colors.ink,
}

const primaryButton = {
  padding: '10px 16px',
  borderRadius: '10px',
  background: colors.purple,
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
}

const secondaryButton = {
  padding: '10px 16px',
  borderRadius: '10px',
  background: 'transparent',
  color: colors.purple,
  fontSize: '13px',
  fontWeight: 600,
}

export function AccountIdentitySection() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('account/me')
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      if (res.ok) {
        const data: MeResponse = await res.json()
        setMe(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading || !me) {
    return (
      <section style={cardStyle}>
        <span className="kola-shimmer" style={{ display: 'block', height: '20px', width: '160px', borderRadius: '4px' }} />
      </section>
    )
  }

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Profile</h2>
      <p className="mt-1" style={{ fontSize: '12px', color: colors.muted }}>
        Name, email, and sign-in credentials.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Name" value={me.fullName ?? '—'} />

        <div>
          <div style={labelStyle}>Primary email</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: '14px', color: colors.ink }}>{me.email?.email ?? '—'}</span>
            {me.email && (
              <VerifiedBadge verified={me.email.verified} />
            )}
          </div>
        </div>

        {me.secondaryEmails.length > 0 && (
          <div>
            <div style={labelStyle}>Other emails</div>
            <ul className="mt-1 space-y-2">
              {me.secondaryEmails.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: '14px', color: colors.ink }}>{e.email}</span>
                    <VerifiedBadge verified={e.verified} />
                  </div>
                  <RemoveEmailButton id={e.id} onRemoved={load} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button
          type="button"
          style={secondaryButton}
          onClick={() => setMode({ kind: 'change-email' })}
        >
          Change email
        </button>
        <button
          type="button"
          style={secondaryButton}
          onClick={() => setMode({ kind: 'change-password' })}
        >
          Change password
        </button>
      </div>

      {mode.kind === 'change-password' && (
        <ChangePasswordForm onDone={() => setMode({ kind: 'idle' })} />
      )}

      {mode.kind === 'change-email' && (
        <ChangeEmailForm onDone={() => { setMode({ kind: 'idle' }); load() }} />
      )}
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div className="mt-1" style={{ fontSize: '14px', color: colors.ink }}>{value}</div>
    </div>
  )
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '999px',
        background: verified ? 'rgba(26,107,60,0.10)' : 'rgba(255,215,0,0.20)',
        color: verified ? colors.green : '#8a6d0a',
      }}
    >
      {verified ? 'Verified' : 'Unverified'}
    </span>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    setErr(null)
    if (next !== confirm) {
      setErr('New password and confirmation do not match.')
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch('account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      if (res.ok) {
        setDone(true)
        setTimeout(onDone, 1500)
        return
      }
      const data = await res.json().catch(() => ({ error: 'Unable to change password' }))
      if (res.status === 401) {
        setErr('Current password is incorrect.')
      } else {
        setErr(typeof data.error === 'string' ? data.error : 'Unable to change password.')
      }
    } catch {
      setErr('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-4 p-3" style={{ background: 'rgba(26,107,60,0.08)', borderRadius: '10px', color: colors.green, fontSize: '13px' }}>
        Password changed. Other devices have been signed out.
      </div>
    )
  }

  return (
    <div className="mt-4 p-4 space-y-3" style={{ background: colors.pageBg, borderRadius: '10px' }}>
      <div>
        <div style={labelStyle}>Current password</div>
        <input type="password" style={inputStyle} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div>
        <div style={labelStyle}>New password</div>
        <input type="password" style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <div style={{ fontSize: '11px', color: colors.muted, marginTop: '4px' }}>
          12+ characters with 3 of: lowercase, uppercase, digit, special char.
        </div>
      </div>
      <div>
        <div style={labelStyle}>Confirm new password</div>
        <input type="password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {err && <div style={{ fontSize: '12px', color: '#b00020' }}>{err}</div>}
      <div className="flex gap-2">
        <button type="button" style={primaryButton} disabled={busy || !current || !next} onClick={submit}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" style={secondaryButton} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function ChangeEmailForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    setBusy(true)
    try {
      const res = await apiFetch('account/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newEmail }),
      })
      if (res.ok) {
        const data = await res.json()
        setSent(data.newEmail)
        return
      }
      const data = await res.json().catch(() => ({ error: 'error' }))
      if (res.status === 401) {
        setErr('Current password is incorrect.')
      } else if (data.error === 'email_taken') {
        setErr('That email is already in use by another account.')
      } else {
        setErr(typeof data.error === 'string' ? data.error : 'Unable to start email change.')
      }
    } catch {
      setErr('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-4 p-3" style={{ background: 'rgba(26,107,60,0.08)', borderRadius: '10px', color: colors.green, fontSize: '13px' }}>
        We&apos;ve sent a verification link to <strong>{sent}</strong>. Click it within 24 hours to finish.
        <div className="mt-2">
          <button type="button" style={secondaryButton} onClick={onDone}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 p-4 space-y-3" style={{ background: colors.pageBg, borderRadius: '10px' }}>
      <div>
        <div style={labelStyle}>Current password</div>
        <input type="password" style={inputStyle} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div>
        <div style={labelStyle}>New email</div>
        <input type="email" style={inputStyle} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
      </div>
      {err && <div style={{ fontSize: '12px', color: '#b00020' }}>{err}</div>}
      <div className="flex gap-2">
        <button type="button" style={primaryButton} disabled={busy || !current || !newEmail} onClick={submit}>
          {busy ? 'Sending…' : 'Send verification link'}
        </button>
        <button type="button" style={secondaryButton} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function RemoveEmailButton({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function remove() {
    if (!confirm('Remove this email from your account?')) return
    setBusy(true)
    setErr(null)
    try {
      const res = await apiFetch(`account/email/${id}`, { method: 'DELETE' })
      if (res.ok) {
        onRemoved()
        return
      }
      const data = await res.json().catch(() => ({ error: 'error' }))
      if (data.error === 'cannot_remove_only_email') {
        setErr('You cannot remove your only verified email.')
      } else {
        setErr('Unable to remove.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span style={{ fontSize: '11px', color: '#b00020' }}>{err}</span>}
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        style={{ fontSize: '12px', color: '#b00020', fontWeight: 500 }}
      >
        {busy ? 'Removing…' : 'Remove'}
      </button>
    </div>
  )
}
