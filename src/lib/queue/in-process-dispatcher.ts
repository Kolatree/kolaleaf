// In-process dispatcher.
//
// Used when REDIS_URL is not set (dev/tests). Invokes the provider handler
// directly in the same process — no queue involved. Same interface as
// BullMQDispatcher so call sites don't care which is active.
//
// Errors from the handler propagate: the route will return 500 and the
// provider will retry, which matches the BullMQ-backed behaviour (there,
// BullMQ retries the job; here, the provider retries the webhook).

import type { WebhookDispatcher, WebhookJob } from './webhook-dispatcher'
import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'
import {
  handleFlutterwaveWebhook,
  handleBudPayWebhook,
} from '@/lib/payments/payout/webhooks'
import { handleSumsubWebhook } from '@/lib/kyc/sumsub/webhook'

export class InProcessDispatcher implements WebhookDispatcher {
  async dispatch(job: WebhookJob): Promise<void> {
    switch (job.provider) {
      case 'monoova':
        await handleMonoovaWebhook(job.rawBody, job.signature)
        return
      case 'flutterwave': {
        const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET
        if (!secret) throw new Error('FLUTTERWAVE_WEBHOOK_SECRET not configured')
        await handleFlutterwaveWebhook(job.rawBody, job.signature, secret)
        return
      }
      case 'budpay': {
        const secret = process.env.BUDPAY_WEBHOOK_SECRET
        if (!secret) throw new Error('BUDPAY_WEBHOOK_SECRET not configured')
        await handleBudPayWebhook(job.rawBody, job.signature, secret)
        return
      }
      case 'sumsub':
        await handleSumsubWebhook(job.rawBody, job.signature)
        return
      default: {
        const _exhaustive: never = job.provider
        throw new Error(`Unknown webhook provider: ${String(_exhaustive)}`)
      }
    }
  }
}
