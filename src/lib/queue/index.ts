// Dispatcher selector.
//
// Lazily selects a dispatcher at first call based on REDIS_URL. In-process
// when absent (dev/tests), BullMQ when present. Cached after selection so
// we don't create a new Queue per webhook.
//
// Tests can reset the cached instance via `__resetWebhookDispatcher()`.

import type { WebhookDispatcher } from './webhook-dispatcher'
import { InProcessDispatcher } from './in-process-dispatcher'
import { BullMQDispatcher } from './bullmq-dispatcher'

let cached: WebhookDispatcher | null = null

export function getWebhookDispatcher(): WebhookDispatcher {
  if (cached) return cached

  const redisUrl = process.env.REDIS_URL
  if (redisUrl && redisUrl.trim() !== '') {
    cached = new BullMQDispatcher(redisUrl)
  } else {
    cached = new InProcessDispatcher()
  }

  return cached
}

// Test hook: reset the cached dispatcher so subsequent calls re-evaluate
// REDIS_URL. Not for production use.
export function __resetWebhookDispatcher(): void {
  cached = null
}

export type { WebhookDispatcher, WebhookJob, WebhookProvider } from './webhook-dispatcher'
export { WEBHOOK_QUEUE_NAME } from './webhook-dispatcher'
