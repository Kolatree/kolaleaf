// Next.js instrumentation hook — runs once per server process at boot.
// We use it to spin up the in-process BullMQ webhook worker so the same
// Railway service handles HTTP requests AND queue consumption.
//
// Skipped when:
//   - NEXT_RUNTIME is not 'nodejs' (we don't need the worker on edge runtimes)
//   - NODE_ENV === 'test' (vitest must not boot a real Redis worker)
//   - REDIS_URL is unset (dev: in-process dispatcher handles webhooks
//     directly; no queue, no worker)
//
// Idempotent — bootInProcessWorker is guarded by a module-scoped flag.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'test') return

  // Dynamic import so the BullMQ + ioredis modules are only loaded on the
  // Node runtime, never during edge bundling.
  const { bootInProcessWorker } = await import('./workers/webhook-worker')
  bootInProcessWorker()
}
