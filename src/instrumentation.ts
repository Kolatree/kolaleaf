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
// Edge runtime is skipped — BullMQ's Redis client needs Node.
// Next.js invokes register() in every runtime; we branch on
// NEXT_RUNTIME to avoid importing the worker module on the edge.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Dynamic import so edge-runtime bundles don't pull bullmq in.
  const { bootInProcessWorker } = await import('./workers/webhook-worker')
  bootInProcessWorker()
}
