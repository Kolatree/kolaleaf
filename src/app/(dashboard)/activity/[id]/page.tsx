import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getSessionFromRequest } from '@/lib/auth/middleware'
import { getUserTransferWithEvents } from '@/lib/transfers'
import { headers } from 'next/headers'
import {
  DashboardShell,
  colors,
  radius,
  shadow,
  spacing,
  GRADIENT,
} from '@/components/design/KolaPrimitives'
import { CancelTransferButton } from './_components/cancel-transfer-button'
import { IssuePayIdButton } from './_components/issue-payid-button'

// Server component — ownership is enforced at the query layer via
// getUserTransferWithEvents (where: { id, userId }). A user asking for a
// transfer that isn't theirs hits notFound() to avoid leaking existence.

// Map status enum → user-facing copy + tone. Keep in sync with
// activity/page.tsx's list view.
const STATUS_TONE: Record<
  string,
  { bg: string; fg: string; label: string; description: string }
> = {
  CREATED: {
    bg: 'rgba(136,136,136,0.15)',
    fg: colors.muted,
    label: 'Pending',
    description: 'Your transfer has been created. Next, issue PayID instructions so you can send the AUD payment.',
  },
  AWAITING_AUD: {
    bg: 'rgba(255,215,0,0.20)',
    fg: '#8a6d0a',
    label: 'Awaiting AUD',
    description: 'We are waiting to receive your AUD. This usually takes a few minutes after you push funds.',
  },
  AUD_RECEIVED: {
    bg: 'rgba(45,27,105,0.10)',
    fg: colors.purple,
    label: 'AUD received',
    description: 'AUD received. We have locked your FX rate and are preparing the NGN payout.',
  },
  PROCESSING_NGN: {
    bg: 'rgba(255,215,0,0.20)',
    fg: '#8a6d0a',
    label: 'Sending',
    description: 'NGN payout in progress. You will be notified when it lands in the recipient account.',
  },
  NGN_SENT: {
    bg: 'rgba(26,107,60,0.10)',
    fg: colors.green,
    label: 'Sent',
    description: 'Payout sent. NGN typically reflects in the recipient account within a few minutes.',
  },
  COMPLETED: {
    bg: 'rgba(26,107,60,0.10)',
    fg: colors.green,
    label: 'Delivered',
    description: 'Transfer complete. The recipient has received the funds.',
  },
  NGN_FAILED: {
    bg: 'rgba(176,0,32,0.10)',
    fg: '#b00020',
    label: 'Failed',
    description: 'Payout failed on the last attempt. We will retry automatically.',
  },
  NGN_RETRY: {
    bg: 'rgba(255,215,0,0.20)',
    fg: '#8a6d0a',
    label: 'Retrying',
    description: 'We are retrying the payout.',
  },
  NEEDS_MANUAL: {
    bg: 'rgba(255,140,0,0.18)',
    fg: '#8a4a0a',
    label: 'Needs review',
    description: 'This transfer needs manual review. Our team will reach out shortly.',
  },
  REFUNDED: {
    bg: 'rgba(45,27,105,0.10)',
    fg: colors.purple,
    label: 'Refunded',
    description: 'The AUD has been refunded to your source account.',
  },
  CANCELLED: {
    bg: 'rgba(136,136,136,0.15)',
    fg: colors.muted,
    label: 'Cancelled',
    description: 'You cancelled this transfer before it was processed.',
  },
  EXPIRED: {
    bg: 'rgba(136,136,136,0.15)',
    fg: colors.muted,
    label: 'Expired',
    description: 'This transfer expired because AUD was not received within 24 hours.',
  },
  FLOAT_INSUFFICIENT: {
    bg: 'rgba(255,215,0,0.20)',
    fg: '#8a6d0a',
    label: 'Paused',
    description: 'Temporarily paused while we top up NGN float. Your funds are safe.',
  },
}

// Statuses where the user is allowed to cancel. Matches the backend gate
// in cancelTransfer — this is a display-only check; the API enforces the
// real guard and is the source of truth.
const CANCELLABLE = new Set(['CREATED', 'AWAITING_AUD'])

function formatAmount(amount: string, currency: string): string {
  const num = parseFloat(amount)
  if (currency === 'NGN') return '₦' + Math.floor(num).toLocaleString('en-NG')
  return (
    'A$' +
    num.toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Humanise a status enum for the timeline rows.
function statusLabel(s: string): string {
  return STATUS_TONE[s]?.label ?? s.replace(/_/g, ' ').toLowerCase()
}

// Build a synthetic Request so we can reuse getSessionFromRequest from a
// server component. Next.js doesn't give us a Request object in pages,
// so we construct one with the cookie header from the incoming headers.
async function getSession() {
  const h = await headers()
  const cookie = h.get('cookie')
  const req = new Request('http://local', { headers: cookie ? { cookie } : {} })
  return getSessionFromRequest(req)
}

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const transfer = await getUserTransferWithEvents(id, session.userId)
  if (!transfer) {
    notFound()
  }

  const tone =
    STATUS_TONE[transfer.status] ?? {
      bg: 'rgba(136,136,136,0.15)',
      fg: colors.muted,
      label: transfer.status.replace(/_/g, ' ').toLowerCase(),
      description: '',
    }

  const cancellable = CANCELLABLE.has(transfer.status)
  const needsPayIdIssuance =
    transfer.status === 'CREATED' && !transfer.payidProviderRef
  const hasPaymentInstructions =
    transfer.status === 'AWAITING_AUD' && !!transfer.payidProviderRef
  const recipientName = transfer.recipient?.fullName ?? 'Unknown recipient'
  const initials = recipientName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')

  return (
    <DashboardShell active="Activity">
      <div className="max-w-[720px] mx-auto space-y-4 kola-stagger">
        {/* Back link + title */}
        <div>
          <Link
            href="/activity"
            style={{ fontSize: '12px', color: colors.purple, fontWeight: 600 }}
          >
            ← Back to activity
          </Link>
          <h1
            className="mt-2"
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: colors.ink,
              letterSpacing: '-0.3px',
            }}
          >
            Transfer details
          </h1>
        </div>

        {/* Summary card */}
        <section
          style={{
            background: colors.cardBg,
            borderRadius: radius.card,
            padding: spacing.cardPad,
            boxShadow: shadow.card,
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span
                className="grid place-items-center"
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '24px',
                  background: GRADIENT,
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {initials || '?'}
              </span>
              <div>
                <div
                  style={{ fontSize: '13px', color: colors.muted }}
                >
                  To
                </div>
                <div
                  style={{ fontSize: '16px', fontWeight: 600, color: colors.ink }}
                >
                  {recipientName}
                </div>
                {transfer.recipient?.bankName && (
                  <div style={{ fontSize: '12px', color: colors.muted }}>
                    {transfer.recipient.bankName}
                  </div>
                )}
              </div>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '999px',
                background: tone.bg,
                color: tone.fg,
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}
            >
              {tone.label}
            </span>
          </div>

          {tone.description && (
            <p
              className="mt-3"
              style={{ fontSize: '13px', color: colors.muted, lineHeight: 1.5 }}
            >
              {tone.description}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div style={{ fontSize: '11px', color: colors.muted }}>You sent</div>
              <div
                className="tabular-nums"
                style={{ fontSize: '18px', fontWeight: 600, color: colors.ink }}
              >
                {formatAmount(transfer.sendAmount.toString(), transfer.sendCurrency)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: colors.muted }}>They receive</div>
              <div
                className="tabular-nums"
                style={{ fontSize: '18px', fontWeight: 600, color: colors.green }}
              >
                {formatAmount(transfer.receiveAmount.toString(), transfer.receiveCurrency)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: colors.muted }}>Rate</div>
              <div
                className="tabular-nums"
                style={{ fontSize: '14px', color: colors.ink }}
              >
                1 {transfer.sendCurrency} ={' '}
                {parseFloat(transfer.exchangeRate.toString()).toLocaleString(
                  'en-AU',
                  { maximumFractionDigits: 4 },
                )}{' '}
                {transfer.receiveCurrency}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: colors.muted }}>Fee</div>
              <div
                className="tabular-nums"
                style={{ fontSize: '14px', color: colors.ink }}
              >
                {formatAmount(transfer.fee.toString(), transfer.sendCurrency)}
              </div>
            </div>
          </div>

          {cancellable && (
            <div className="mt-4">
              <CancelTransferButton transferId={transfer.id} />
            </div>
          )}
        </section>

        {(needsPayIdIssuance || hasPaymentInstructions) && (
          <section
            style={{
              background: colors.cardBg,
              borderRadius: radius.card,
              padding: spacing.cardPad,
              boxShadow: shadow.card,
            }}
          >
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>
              AUD payment instructions
            </h2>

            {needsPayIdIssuance ? (
              <>
                <p
                  className="mt-3"
                  style={{ fontSize: '13px', color: colors.muted, lineHeight: 1.5 }}
                >
                  This transfer is still waiting for PayID instructions. Issue them now to
                  start the AUD payment step.
                </p>
                <div className="mt-4">
                  <IssuePayIdButton transferId={transfer.id} />
                </div>
              </>
            ) : null}

            {hasPaymentInstructions ? (
              <div className="mt-3 grid gap-3 text-sm">
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted }}>PayID</div>
                  <div
                    className="mt-1 tabular-nums break-all"
                    style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}
                  >
                    {transfer.payidProviderRef}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted }}>Reference</div>
                  <div
                    className="mt-1 tabular-nums break-all"
                    style={{ fontSize: '14px', color: colors.ink }}
                  >
                    {transfer.payidReference ?? transfer.id}
                  </div>
                </div>
                <p
                  style={{ fontSize: '12px', color: colors.muted, lineHeight: 1.5 }}
                >
                  Send the exact AUD amount from your bank and include the reference so we
                  can match the payment to this transfer.
                </p>
              </div>
            ) : null}
          </section>
        )}

        {/* Timeline card */}
        <section
          style={{
            background: colors.cardBg,
            borderRadius: radius.card,
            padding: spacing.cardPad,
            boxShadow: shadow.card,
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>
            Timeline
          </h2>
          <ol className="mt-3 space-y-3">
            {transfer.events.length === 0 ? (
              <li style={{ fontSize: '13px', color: colors.muted }}>
                No events recorded yet.
              </li>
            ) : (
              transfer.events.map((e, i) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span
                    className="shrink-0 mt-1.5"
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '4px',
                      background:
                        i === transfer.events.length - 1 ? colors.green : colors.purple,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: colors.ink,
                      }}
                    >
                      {statusLabel(e.toStatus)}
                    </div>
                    <div style={{ fontSize: '11px', color: colors.muted }}>
                      {formatDateTime(e.createdAt)} · {e.actor.toLowerCase()}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ol>
        </section>

        {/* Reference */}
        <section
          style={{
            background: colors.cardBg,
            borderRadius: radius.card,
            padding: spacing.cardPad,
            boxShadow: shadow.card,
          }}
        >
          <div style={{ fontSize: '11px', color: colors.muted }}>
            Transfer reference
          </div>
          <div
            className="mt-1 tabular-nums break-all"
            style={{ fontSize: '12px', color: colors.ink }}
          >
            {transfer.id}
          </div>
          <div
            className="mt-3"
            style={{ fontSize: '11px', color: colors.muted }}
          >
            Created {formatDateTime(transfer.createdAt)}
          </div>
        </section>
      </div>
    </DashboardShell>
  )
}
