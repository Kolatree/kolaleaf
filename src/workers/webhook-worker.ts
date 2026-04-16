// Webhook worker.
//
// Standalone process that subscribes to the `webhooks` BullMQ queue and
// dispatches each job to the provider handler. Run via:
//
//   npm run worker
//
// Or directly:
//
//   npx tsx src/workers/webhook-worker.ts
//
// Behaviour:
// - Re-verifies the signature at job start (defense-in-depth — the route
//   already did this, but the worker can't assume a well-behaved producer).
// - Delegates to the same handler functions used by InProcessDispatcher.
//   The handler's create-as-lock idempotency on WebhookEvent is the
//   authoritative dedup.
// - Logs structured lines per job: start, success, failure.
// - On failure, rethrows so BullMQ retries per the queue's attempts +
//   exponential backoff config.

import 'dotenv/config'
import { Worker, type Job } from 'bullmq'
import {
  WEBHOOK_QUEUE_NAME,
  type WebhookJob,
  type WebhookProvider,
} from '@/lib/queue/webhook-dispatcher'
import { createRedisConnection } from '@/lib/queue/bullmq-dispatcher'
import { verifyMonoovaSignature } from '@/lib/payments/monoova/verify-signature'
import { verifySumsubSignature } from '@/lib/kyc/sumsub/verify-signature'
import {
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
} from '@/lib/payments/payout/verify-signature'
import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'
import {
  handleFlutterwaveWebhook,
  handlePaystackWebhook,
} from '@/lib/payments/payout/webhooks'
import { handleSumsubWebhook } from '@/lib/kyc/sumsub/webhook'

function log(
  level: 'info' | 'error',
  event: string,
  data: Record<string, unknown>,
) {
  const line = {
    level,
    event,
    ts: new Date().toISOString(),
    ...data,
  }
  if (level === 'error') {
    console.error(JSON.stringify(line))
  } else {
    console.log(JSON.stringify(line))
  }
}

// Verify the signature and return the resolved secret so the caller can pass
// it into handlers that expect one (Flutterwave, Paystack) without a second
// env lookup. The two lookups were harmless but invited drift.
function verify(
  provider: WebhookProvider,
  rawBody: string,
  signature: string,
): string {
  switch (provider) {
    case 'monoova': {
      const secret = process.env.MONOOVA_WEBHOOK_SECRET
      if (!secret) throw new Error('MONOOVA_WEBHOOK_SECRET not configured')
      if (!verifyMonoovaSignature(rawBody, signature, secret)) {
        throw new Error('Invalid webhook signature')
      }
      return secret
    }
    case 'sumsub': {
      const secret = process.env.SUMSUB_WEBHOOK_SECRET
      if (!secret) throw new Error('SUMSUB_WEBHOOK_SECRET not configured')
      if (!verifySumsubSignature(rawBody, signature, secret)) {
        throw new Error('Invalid webhook signature')
      }
      return secret
    }
    case 'flutterwave': {
      const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET
      if (!secret) throw new Error('FLUTTERWAVE_WEBHOOK_SECRET not configured')
      if (!verifyFlutterwaveSignature(signature, secret)) {
        throw new Error('Invalid Flutterwave webhook signature')
      }
      return secret
    }
    case 'paystack': {
      const secret = process.env.PAYSTACK_SECRET_KEY
      if (!secret) throw new Error('PAYSTACK_SECRET_KEY not configured')
      if (!verifyPaystackSignature(rawBody, signature, secret)) {
        throw new Error('Invalid Paystack webhook signature')
      }
      return secret
    }
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown webhook provider: ${String(_exhaustive)}`)
    }
  }
}

async function processJob(job: Job<WebhookJob>): Promise<void> {
  const { provider, rawBody, signature } = job.data

  log('info', 'webhook.job.start', {
    jobId: job.id,
    provider,
    attempt: job.attemptsMade + 1,
  })

  const secret = verify(provider, rawBody, signature)

  switch (provider) {
    case 'monoova':
      await handleMonoovaWebhook(rawBody, signature)
      break
    case 'flutterwave':
      await handleFlutterwaveWebhook(rawBody, signature, secret)
      break
    case 'paystack':
      await handlePaystackWebhook(rawBody, signature, secret)
      break
    case 'sumsub':
      await handleSumsubWebhook(rawBody, signature)
      break
  }

  log('info', 'webhook.job.success', { jobId: job.id, provider })
}

function main(): Worker<WebhookJob> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to run the webhook worker')
  }

  const connection = createRedisConnection(redisUrl)

  const worker = new Worker<WebhookJob>(WEBHOOK_QUEUE_NAME, processJob, {
    connection,
    concurrency: Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? 4),
  })

  worker.on('failed', (job, err) => {
    log('error', 'webhook.job.failed', {
      jobId: job?.id,
      provider: job?.data.provider,
      attempt: (job?.attemptsMade ?? 0) + 1,
      error: err.message,
    })
  })

  worker.on('ready', () => {
    log('info', 'webhook.worker.ready', { queue: WEBHOOK_QUEUE_NAME })
  })

  // ioredis connection errors surface as `error` events on the Worker.
  // Without a listener Node emits an unhandled-exception warning. BullMQ
  // reconnects on its own; we just need to log so on-call can see it.
  worker.on('error', (err) => {
    log('error', 'webhook.worker.error', { error: err.message })
  })

  const shutdown = async (signal: string) => {
    log('info', 'webhook.worker.shutdown', { signal })
    await worker.close()
    await connection.quit()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  return worker
}

// Run when invoked directly (not when imported).
if (require.main === module) {
  main()
}

export { main, processJob as __processJob }
