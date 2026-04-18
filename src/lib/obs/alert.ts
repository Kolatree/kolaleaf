import { log } from './logger'
import { enqueueEmail } from '@/lib/queue/email-dispatcher'

// Dual-purpose alert emit.
//
//   1. log('warn', event, data) — structured line Railway aggregates
//      and any future SaaS ingestion picks up.
//   2. enqueueEmail(ops_alert) — durable delivery to the ops inbox
//      via the existing BullMQ email queue (Step 23). Retries,
//      FailedEmail sink, all included. The ops inbox address is
//      OPS_ALERT_EMAIL (single address or comma-separated list —
//      the Resend side handles splitting).
//
// When OPS_ALERT_EMAIL is unset (dev/tests) we skip the enqueue and
// only log. Keeps the helper safe to call from anywhere without
// gating on env shape at every call site.

const ENV_OPS_ALERT_EMAIL = 'OPS_ALERT_EMAIL'

export async function alertOps(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  log('warn', event, data)

  const opsEmail = process.env[ENV_OPS_ALERT_EMAIL]
  if (!opsEmail || opsEmail.trim() === '') return

  try {
    await enqueueEmail({
      template: 'ops_alert',
      toEmail: opsEmail,
      event,
      data,
      env: process.env.NODE_ENV ?? 'development',
      occurredAt: new Date().toISOString(),
    })
  } catch (err) {
    // Alert delivery failing can't itself fail an alert caller. We log
    // the enqueue failure and move on — the original log('warn',...)
    // above is the minimum audit trail.
    log('error', 'alert.delivery.enqueue_failed', {
      originalEvent: event,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
