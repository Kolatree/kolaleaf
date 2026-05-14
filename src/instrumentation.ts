// Next.js instrumentation hook. Called once per server process at
// boot (Node runtime only — Next.js calls `register` exactly once
// per distinct runtime). This is where the in-process BullMQ
// workers come up so the same Railway container serves HTTP and
// drains the webhook + email queues from the same node.
//
// Without this file the queues still receive jobs (enqueueEmail /
// enqueueWebhook in the request path) but nothing pulls them off
// Redis — the symptom is "email verification code never arrives,
// no FailedEmail row, Resend dashboard empty." We hit that on the
// Wave 1 push.
//
// Why co-host rather than a separate worker service: Wave 1 runs
// on one Railway service. A split would double infra cost and
// require a second deploy pipeline for minimal throughput benefit
// at this stage.
//
// Edge runtime only loads Sentry's edge SDK. BullMQ's Redis client
// needs Node, so workers stay behind the nodejs branch.

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
    return
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  await import('./sentry.server.config')

  // Dynamic import so edge-runtime bundles don't pull bullmq in.
  const { bootInProcessWorker } = await import('./workers/webhook-worker')
  bootInProcessWorker()
}

export const onRequestError = Sentry.captureRequestError
