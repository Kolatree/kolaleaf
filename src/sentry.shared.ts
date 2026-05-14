import type { ErrorEvent, EventHint, SpanJSON, TransactionEvent } from '@sentry/core'

import { scrubPiiForSentry } from './lib/obs/pii-scrubber'

export function getSentryDsn(scope: 'client' | 'server'): string | undefined {
  if (scope === 'client') return process.env.NEXT_PUBLIC_SENTRY_DSN
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
}

export function getSentryEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ??
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  )
}

export function getSentryTracesSampleRate(): number {
  const configured = process.env.SENTRY_TRACES_SAMPLE_RATE
  if (configured !== undefined) {
    const parsed = Number(configured)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
  }
  return process.env.NODE_ENV === 'production' ? 0.05 : 1.0
}

export function beforeSend(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  return scrubPiiForSentry(event)
}

export function beforeSendTransaction(event: TransactionEvent): TransactionEvent | null {
  return scrubPiiForSentry(event)
}

export function beforeSendSpan(span: SpanJSON): SpanJSON {
  return scrubPiiForSentry(span)
}
