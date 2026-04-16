// BullMQ-backed dispatcher.
//
// Enqueues webhook jobs onto the `webhooks` queue for the worker to pick
// up. Used when REDIS_URL is set (staging/prod).
//
// Job dedup: the BullMQ jobId is a SHA-256 hash of the raw body. BullMQ
// rejects duplicate jobIds at enqueue time — this is defense-in-depth on
// top of the handler's WebhookEvent unique-constraint idempotency. If the
// provider retries the same payload, the queue absorbs it rather than
// creating duplicate processing.

import crypto from 'crypto'
import { Queue, type QueueOptions } from 'bullmq'
import IORedis, { type RedisOptions } from 'ioredis'
import type {
  WebhookDispatcher,
  WebhookJob,
} from './webhook-dispatcher'
import { WEBHOOK_QUEUE_NAME } from './webhook-dispatcher'

export const WEBHOOK_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 } as const,
  removeOnComplete: 1000,
  removeOnFail: 5000,
}

// Build a Redis connection from REDIS_URL. `maxRetriesPerRequest: null` is
// required by BullMQ for blocking operations (worker-side); we set it here
// too so the same connection shape works for both producer and worker.
export function createRedisConnection(url: string): IORedis {
  const opts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  }
  return new IORedis(url, opts)
}

function jobIdFor(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex')
}

export class BullMQDispatcher implements WebhookDispatcher {
  private queue: Queue<WebhookJob>

  constructor(connectionOrUrl: IORedis | string) {
    const connection =
      typeof connectionOrUrl === 'string'
        ? createRedisConnection(connectionOrUrl)
        : connectionOrUrl

    const queueOpts: QueueOptions = { connection }
    this.queue = new Queue<WebhookJob>(WEBHOOK_QUEUE_NAME, queueOpts)
  }

  async dispatch(job: WebhookJob): Promise<void> {
    const jobId = jobIdFor(job.rawBody)
    await this.queue.add(job.provider, job, {
      jobId,
      ...WEBHOOK_JOB_OPTS,
    })
  }

  // Exposed for worker/shutdown paths.
  async close(): Promise<void> {
    await this.queue.close()
  }
}
