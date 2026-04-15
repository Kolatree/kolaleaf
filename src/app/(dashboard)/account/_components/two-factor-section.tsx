'use client'

import { useEffect, useState } from 'react'
import { colors, radius, shadow, spacing } from '@/components/design/KolaPrimitives'

type Method = 'NONE' | 'TOTP' | 'SMS'

interface TwoFactorState {
  method: Method
  enabledAt: string | null
  phoneMasked: string | null
  hasVerifiedPhone: boolean
}

type UiMode =
  | { kind: 'view' }
  | { kind: 'picker' }
  | { kind: 'totp-setup'; secret: string; otpauthUri: string; qrDataUrl: string }
  | { kind: 'sms-setup'; challengeId: string }
  | { kind: 'backup-codes'; codes: string[] }
  | { kind: 'disable' }
  | { kind: 'regen' }
  | { kind: 'regen-sms-challenge'; challengeId: string }
  | { kind: 'disable-sms-challenge'; challengeId: string }

const SOFT_BORDER = '1px solid rgba(136,136,136,0.18)'

// Small inline primitives — Variant D tokens only.

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  type?: 'button' | 'submit'
}) {
  const palette =
    variant === 'primary'
      ? { bg: colors.purple, fg: '#fff' }
      : variant === 'danger'
      ? { bg: '#b00020', fg: '#fff' }
      : { bg: 'transparent', fg: colors.ink }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="disabled:opacity-60"
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: '10px 16px',
        borderRadius: radius.cta,
        fontSize: '13px',
        fontWeight: 600,
        border: variant === 'secondary' ? SOFT_BORDER : 'none',
      }}
    >
      {children}
    </button>
  )
}

function CodeInput({
  value,
  onChange,
  placeholder = '123456',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '12px 14px',
        borderRadius: radius.cta,
        border: SOFT_BORDER,
        fontSize: '15px',
        letterSpacing: '0.15em',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        background: '#fff',
        color: colors.ink,
      }}
    />
  )
}

function InlineNotice({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const palette =
    tone === 'error'
      ? { bg: 'rgba(176,0,32,0.08)', border: 'rgba(176,0,32,0.35)', text: '#b00020' }
      : tone === 'warn'
      ? { bg: 'rgba(255,215,0,0.12)', border: 'rgba(255,215,0,0.45)', text: '#8a6d0a' }
      : { bg: 'rgba(45,27,105,0.06)', border: 'rgba(45,27,105,0.25)', text: colors.purple }
  return (
    <div
      role="status"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: radius.cta,
        padding: '10px 12px',
        fontSize: '12px',
        fontWeight: 500,
        color: palette.text,
      }}
    >
      {children}
    </div>
  )
}

function Tile({
  title,
  desc,
  badge,
  onClick,
  disabled,
  hint,
}: {
  title: string
  desc: string
  badge?: string
  onClick: () => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="disabled:opacity-50 disabled:cursor-not-allowed text-left"
      style={{
        width: '100%',
        padding: '14px 16px',
        borderRadius: radius.cta,
        border: SOFT_BORDER,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span style={{ fontSize: '14px', fontWeight: 600, color: colors.ink }}>{title}</span>
        {badge ? (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '999px',
              background: 'rgba(26,107,60,0.12)',
              color: colors.green,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <span style={{ fontSize: '12px', color: colors.muted }}>{desc}</span>
      {hint ? <span style={{ fontSize: '11px', color: '#b00020' }}>{hint}</span> : null}
    </button>
  )
}

export function TwoFactorSection() {
  const [state, setState] = useState<TwoFactorState | null>(null)
  const [mode, setMode] = useState<UiMode>({ kind: 'view' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [ack, setAck] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/account/me')
        if (cancelled) return
        if (res.status === 401) {
          // Session expired between page load and this fetch. Rather than
          // render a bogus 'NONE' state that invites the user to re-enroll,
          // bounce them to /login — the dashboard layout will re-protect
          // subsequent navigation.
          window.location.href = '/login'
          return
        }
        if (res.ok) {
          const data = await res.json()
          setState({
            method: data.twoFactorMethod ?? 'NONE',
            enabledAt: data.twoFactorEnabledAt ?? null,
            phoneMasked: data.phoneMasked ?? null,
            hasVerifiedPhone: Boolean(data.hasVerifiedPhone),
          })
        } else {
          // Non-401 failure — assume disabled so user can still enable.
          setState({ method: 'NONE', enabledAt: null, phoneMasked: null, hasVerifiedPhone: false })
        }
      } catch {
        if (!cancelled) {
          setState({ method: 'NONE', enabledAt: null, phoneMasked: null, hasVerifiedPhone: false })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function resetForms(): void {
    setCode('')
    setAck(false)
    setError(null)
  }

  async function startSetup(method: 'TOTP' | 'SMS') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(humanError(data.error))
        return
      }
      resetForms()
      if (method === 'TOTP') {
        setMode({
          kind: 'totp-setup',
          secret: data.secret,
          otpauthUri: data.otpauthUri,
          qrDataUrl: data.qrDataUrl,
        })
      } else {
        setMode({ kind: 'sms-setup', challengeId: data.challengeId })
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    if (mode.kind !== 'totp-setup' && mode.kind !== 'sms-setup') return
    setBusy(true)
    setError(null)
    try {
      const payload =
        mode.kind === 'totp-setup'
          ? { method: 'TOTP', secret: mode.secret, code }
          : { method: 'SMS', challengeId: mode.challengeId, code }
      const res = await fetch('/api/account/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(humanError(data.error))
        return
      }
      resetForms()
      setMode({ kind: 'backup-codes', codes: data.backupCodes })
      // refresh state in background -- we'll re-read on continue
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { code }
      if (mode.kind === 'disable-sms-challenge') body.challengeId = mode.challengeId
      const res = await fetch('/api/account/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(humanError(data.error))
        return
      }
      resetForms()
      setState({ method: 'NONE', enabledAt: null, phoneMasked: state?.phoneMasked ?? null, hasVerifiedPhone: state?.hasVerifiedPhone ?? false })
      setMode({ kind: 'view' })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function regen() {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { code }
      if (mode.kind === 'regen-sms-challenge') body.challengeId = mode.challengeId
      const res = await fetch('/api/account/2fa/regenerate-backup-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(humanError(data.error))
        return
      }
      resetForms()
      setMode({ kind: 'backup-codes', codes: data.backupCodes })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // For SMS users who want to disable or regenerate codes: there's no
  // mid-session SMS re-issue route. Guidance is baked directly into the
  // surrounding copy ("enter a backup code or the last SMS code from
  // sign-in") so users have a clear path without a dead-end button.

  async function continueAfterBackupCodes() {
    // Refresh state from server so the view reflects enabled/disabled.
    try {
      const res = await fetch('/api/account/me')
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      if (res.ok) {
        const data = await res.json()
        setState({
          method: data.twoFactorMethod ?? 'NONE',
          enabledAt: data.twoFactorEnabledAt ?? null,
          phoneMasked: data.phoneMasked ?? null,
          hasVerifiedPhone: Boolean(data.hasVerifiedPhone),
        })
      }
    } catch {
      // Leave state as-is; still works in the worst case.
    }
    resetForms()
    setMode({ kind: 'view' })
  }

  function copyAll(codes: string[]): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(codes.join('\n')).catch(() => {
      // Silent -- user can manually select the codes.
    })
  }

  // ---- Render ----

  return (
    <section
      style={{
        background: colors.cardBg,
        borderRadius: radius.card,
        padding: spacing.cardPad,
        boxShadow: shadow.card,
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>
            Two-factor authentication
          </h2>
          <p className="mt-1" style={{ fontSize: '12px', color: colors.muted }}>
            Require a second code at login to protect your account.
          </p>
        </div>
        {!loading ? (
          <StatusPill method={state?.method ?? 'NONE'} />
        ) : (
          <span className="kola-shimmer" style={{ width: '72px', height: '24px', borderRadius: '999px' }} />
        )}
      </div>

      <div className="mt-4 space-y-3">
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

        {loading ? (
          <div className="kola-shimmer" style={{ height: '40px', borderRadius: radius.cta }} />
        ) : state?.method === 'NONE' ? (
          <ViewDisabled
            mode={mode}
            onEnableClick={() => {
              resetForms()
              setMode({ kind: 'picker' })
            }}
            onPickTotp={() => startSetup('TOTP')}
            onPickSms={() => startSetup('SMS')}
            hasVerifiedPhone={state?.hasVerifiedPhone ?? false}
            busy={busy}
            code={code}
            setCode={setCode}
            onEnable={enable}
            onCancel={() => {
              resetForms()
              setMode({ kind: 'view' })
            }}
            onResendSms={() => startSetup('SMS')}
          />
        ) : (
          <ViewEnabled
            state={state}
            mode={mode}
            busy={busy}
            code={code}
            setCode={setCode}
            onDisableClick={() => {
              resetForms()
              setMode({ kind: 'disable' })
            }}
            onRegenClick={() => {
              resetForms()
              setMode({ kind: 'regen' })
            }}
            onConfirmDisable={disable}
            onConfirmRegen={regen}
            onCancel={() => {
              resetForms()
              setMode({ kind: 'view' })
            }}
          />
        )}

        {mode.kind === 'backup-codes' ? (
          <BackupCodesPanel
            codes={mode.codes}
            ack={ack}
            setAck={setAck}
            onCopy={() => copyAll(mode.codes)}
            onContinue={continueAfterBackupCodes}
          />
        ) : null}
      </div>
    </section>
  )
}

function StatusPill({ method }: { method: Method }) {
  const palette =
    method === 'NONE'
      ? { bg: 'rgba(136,136,136,0.15)', fg: colors.muted, text: 'Off' }
      : { bg: 'rgba(26,107,60,0.10)', fg: colors.green, text: 'On' }
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: '999px',
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {palette.text}
    </span>
  )
}

function ViewDisabled({
  mode,
  onEnableClick,
  onPickTotp,
  onPickSms,
  hasVerifiedPhone,
  busy,
  code,
  setCode,
  onEnable,
  onCancel,
  onResendSms,
}: {
  mode: UiMode
  onEnableClick: () => void
  onPickTotp: () => void
  onPickSms: () => void
  hasVerifiedPhone: boolean
  busy: boolean
  code: string
  setCode: (v: string) => void
  onEnable: () => void
  onCancel: () => void
  onResendSms: () => void
}) {
  if (mode.kind === 'picker') {
    return (
      <div className="space-y-2">
        <Tile
          title="Authenticator app (TOTP)"
          desc="Use an app like 1Password, Google Authenticator or Authy. No phone signal required."
          badge="Recommended"
          onClick={onPickTotp}
          disabled={busy}
        />
        <Tile
          title="Text message (SMS)"
          desc="We send a 6-digit code to your verified phone at login."
          onClick={onPickSms}
          disabled={busy || !hasVerifiedPhone}
          hint={!hasVerifiedPhone ? 'Verify a phone number first to enable SMS 2FA.' : undefined}
        />
        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (mode.kind === 'totp-setup') {
    return (
      <div className="space-y-3">
        <p style={{ fontSize: '13px', color: colors.ink }}>
          Scan this QR code in your authenticator app, then enter the 6-digit code it shows.
        </p>
        <div className="flex items-center justify-center" style={{ padding: '12px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from server, no optimization needed */}
          <img
            src={mode.qrDataUrl}
            alt="Authenticator QR code"
            style={{ width: '200px', height: '200px', borderRadius: radius.cta, border: SOFT_BORDER }}
          />
        </div>
        <p style={{ fontSize: '11px', color: colors.muted, textAlign: 'center' }}>
          Can&rsquo;t scan? Enter this key manually:
        </p>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12px',
            padding: '8px 10px',
            borderRadius: radius.cta,
            background: 'rgba(45,27,105,0.05)',
            color: colors.ink,
            textAlign: 'center',
            wordBreak: 'break-all',
          }}
        >
          {mode.secret}
        </div>
        <CodeInput value={code} onChange={setCode} autoFocus />
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onEnable} disabled={busy || code.length < 6}>
            {busy ? 'Verifying...' : 'Enable'}
          </Button>
        </div>
      </div>
    )
  }

  if (mode.kind === 'sms-setup') {
    return (
      <div className="space-y-3">
        <p style={{ fontSize: '13px', color: colors.ink }}>
          We sent a 6-digit code to your verified phone. Enter it below to turn on SMS 2FA.
        </p>
        <CodeInput value={code} onChange={setCode} autoFocus />
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onResendSms} disabled={busy}>
            Resend code
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onEnable} disabled={busy || code.length < 6}>
            {busy ? 'Verifying...' : 'Enable'}
          </Button>
        </div>
      </div>
    )
  }

  // Default view when disabled
  return (
    <div>
      <p style={{ fontSize: '13px', color: colors.muted }}>
        2FA is currently off. Protect your account by requiring a second code at sign-in.
      </p>
      <div className="mt-3">
        <Button onClick={onEnableClick}>Enable 2FA</Button>
      </div>
    </div>
  )
}

function ViewEnabled({
  state,
  mode,
  busy,
  code,
  setCode,
  onDisableClick,
  onRegenClick,
  onConfirmDisable,
  onConfirmRegen,
  onCancel,
}: {
  state: TwoFactorState | null
  mode: UiMode
  busy: boolean
  code: string
  setCode: (v: string) => void
  onDisableClick: () => void
  onRegenClick: () => void
  onConfirmDisable: () => void
  onConfirmRegen: () => void
  onCancel: () => void
}) {
  const enabledLabel =
    state?.method === 'TOTP'
      ? 'Authenticator app'
      : state?.method === 'SMS'
      ? `Text message to ${state.phoneMasked ?? 'your phone'}`
      : 'On'

  const enabledSince =
    state?.enabledAt ? new Date(state.enabledAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null

  if (mode.kind === 'disable' || mode.kind === 'disable-sms-challenge') {
    const smsHint = state?.method === 'SMS'
    return (
      <div className="space-y-3">
        <InlineNotice tone="warn">
          Disabling 2FA signs out all other devices. Enter your current code or a backup code.
        </InlineNotice>
        {smsHint ? (
          <p style={{ fontSize: '12px', color: colors.muted }}>
            For SMS 2FA, enter one of your saved backup codes, or the most recent
            SMS code sent at sign-in.
          </p>
        ) : null}
        <CodeInput value={code} onChange={setCode} autoFocus />
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirmDisable} disabled={busy || code.length === 0}>
            {busy ? 'Disabling...' : 'Disable 2FA'}
          </Button>
        </div>
      </div>
    )
  }

  if (mode.kind === 'regen' || mode.kind === 'regen-sms-challenge') {
    return (
      <div className="space-y-3">
        <InlineNotice tone="info">
          Regenerating codes invalidates your existing backup codes.
        </InlineNotice>
        <CodeInput value={code} onChange={setCode} autoFocus />
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirmRegen} disabled={busy || code.length === 0}>
            {busy ? 'Regenerating...' : 'Generate new codes'}
          </Button>
        </div>
      </div>
    )
  }

  // Default enabled view
  return (
    <div>
      <div>
        <div style={{ fontSize: '14px', color: colors.ink, fontWeight: 600 }}>{enabledLabel}</div>
        {enabledSince ? (
          <div className="mt-1" style={{ fontSize: '12px', color: colors.muted }}>
            Enabled {enabledSince}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onRegenClick}>
          Regenerate backup codes
        </Button>
        <Button variant="danger" onClick={onDisableClick}>
          Disable 2FA
        </Button>
      </div>
    </div>
  )
}

function BackupCodesPanel({
  codes,
  ack,
  setAck,
  onCopy,
  onContinue,
}: {
  codes: string[]
  ack: boolean
  setAck: (v: boolean) => void
  onCopy: () => void
  onContinue: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Backup codes"
      style={{
        background: 'rgba(255,215,0,0.12)',
        border: '1px solid rgba(255,215,0,0.45)',
        borderRadius: radius.card,
        padding: '16px',
      }}
    >
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#8a6d0a' }}>
        Save these backup codes now
      </div>
      <p className="mt-1" style={{ fontSize: '12px', color: '#8a6d0a' }}>
        Each code works once. You won&rsquo;t see them again. Store them somewhere safe.
      </p>
      <div
        className="mt-3 grid grid-cols-2 gap-2"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: colors.ink,
        }}
      >
        {codes.map((c) => (
          <div
            key={c}
            style={{
              padding: '8px 10px',
              borderRadius: radius.cta,
              background: '#fff',
              border: '1px solid rgba(255,215,0,0.45)',
              textAlign: 'center',
            }}
          >
            {c}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-2" style={{ fontSize: '12px', color: '#8a6d0a' }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I&rsquo;ve saved these codes somewhere safe
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCopy}>
            Copy all
          </Button>
          <Button onClick={onContinue} disabled={!ack}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function humanError(code: unknown): string {
  switch (code) {
    case 'already_enabled':
      return '2FA is already enabled. Disable it first.'
    case 'not_enabled':
      return '2FA is not enabled.'
    case 'invalid_code':
      return "That code didn't match. Try again."
    case 'phone_not_verified':
      return 'Verify a phone number before using SMS 2FA.'
    case 'email_required':
      return 'An email identifier is required for authenticator 2FA.'
    case 'missing_fields':
      return 'Please fill in all required fields.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
