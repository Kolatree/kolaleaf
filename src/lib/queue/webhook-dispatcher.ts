// Webhook dispatcher interface.
//
// Routes (src/app/api/webhooks/*) verify the provider signature, then hand
// off the raw payload to a dispatcher. The dispatcher implementation is
// selected at call time: BullMQ in production (REDIS_URL set), in-process
// for dev/tests.
//
// This keeps the route handler free of BullMQ imports and lets tests stay
// hermetic — no Redis required.

export type WebhookProvider = 'monoova' | 'flutterwave' | 'paystack' | 'sumsub'

export interface WebhookJob {
  provider: WebhookProvider
  rawBody: string
  signature: string
  receivedAt: string // ISO timestamp
}

export interface WebhookDispatcher {
  dispatch(job: WebhookJob): Promise<void>
}

export const WEBHOOK_QUEUE_NAME = 'webhooks'
