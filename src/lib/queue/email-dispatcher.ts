// Email queue dispatcher.
//
// Same shape as the webhook dispatcher (BullMQ when REDIS_URL is set,
// in-process otherwise). Moves Resend sends off the request path so
// user-facing latency is ~5ms (enqueue) rather than 400-900ms (Resend
// round-trip), and makes delivery durable — transient Resend errors
// retry on exponential backoff, permanent failures land in the
// `FailedEmail` table for admin visibility.
//
// Call sites enqueue via `enqueueEmail(data)`. The worker (or the
// in-process dispatcher during dev/test) calls `handleEmailJob(data,
// attemptsMade, maxAttempts)` which runs the actual send and, on the
// last attempt, persists a FailedEmail row before rethrowing.

import crypto from 'crypto'
import { Queue, type QueueOptions } from 'bullmq'
import { createRedisConnection } from './bullmq-dispatcher'
import { prisma } from '@/lib/db/client'
import {
  sendEmail,
  renderVerificationEmail,
  renderPasswordResetEmail,
  renderOpsAlertEmail,
} from '@/lib/email'
import { EMAIL_CODE_TTL_MINUTES } from '@/lib/auth/constants'

export const EMAIL_QUEUE_NAME = 'email'

// Retry policy: 8 attempts, 5s -> ~10min exponential ceiling. Longer
// than the webhook queue (5 attempts) because emails are user-facing
// and permanent loss is worse than a few extra retries.
export const EMAIL_JOB_OPTS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 5000 } as const,
  removeOnComplete: 1000,
  removeOnFail: false as const,
}

export type EmailJob =
  | {
      template: 'verification_code'
      toEmail: string
      recipientName: string
      code: string
      expiresInMinutes: number
    }
  | {
      template: 'password_reset'
      toEmail: string
      recipientName: string
      resetUrl: string
      expiresInMinutes: number
      ip?: string
      userAgent?: string
    }
  | {
      template: 'ops_alert'
      toEmail: string
      event: string
      data: Record<string, unknown>
      env: string
      occurredAt: string
    }

export interface EmailDispatcher {
  dispatch(job: EmailJob): Promise<void>
}

// Deterministic jobId for dedupe: same email + template + payload -> same id.
// Protects against accidental double-enqueue on route retries.
function jobIdFor(job: EmailJob): string {
  // Material composition per template — two different inputs of the
  // same template must produce different ids; ops_alert uses the
  // (event, data) shape rather than a synthetic url or code.
  const material =
    job.template === 'verification_code'
      ? `${job.template}|${job.toEmail}|${job.code}`
      : job.template === 'password_reset'
        ? `${job.template}|${job.toEmail}|${job.resetUrl}`
        : `${job.template}|${job.toEmail}|${job.event}|${job.occurredAt}`
  return crypto.createHash('sha256').update(material).digest('hex')
}

// Run the actual send. Called from the in-process dispatcher AND from
// the worker. On the FINAL attempt only, a failure writes to FailedEmail
// before rethrowing — intermediate failures retry silently.
export async function handleEmailJob(
  job: EmailJob,
  attemptsMade: number,
  maxAttempts: number,
): Promise<void> {
  const rendered =
    job.template === 'verification_code'
      ? renderVerificationEmail({
          recipientName: job.recipientName,
          code: job.code,
          expiresInMinutes: job.expiresInMinutes ?? EMAIL_CODE_TTL_MINUTES,
        })
      : job.template === 'password_reset'
        ? renderPasswordResetEmail({
            recipientName: job.recipientName,
            resetUrl: job.resetUrl,
            expiresInMinutes: job.expiresInMinutes,
            ip: job.ip,
            userAgent: job.userAgent,
          })
        : renderOpsAlertEmail({
            event: job.event,
            data: job.data,
            env: job.env,
            occurredAt: job.occurredAt,
          })

  const result = await sendEmail({
    to: job.toEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })

  if (!result.ok) {
    const err = new Error(result.error ?? 'Resend send failed')
    const isLastAttempt = attemptsMade + 1 >= maxAttempts
    if (isLastAttempt) {
      await prisma.failedEmail.create({
        data: {
          toEmail: job.toEmail,
          template: job.template,
          payloadHash: jobIdFor(job),
          attempts: maxAttempts,
          lastError: err.message,
        },
      })
    }
    throw err
  }
}

export class InProcessEmailDispatcher implements EmailDispatcher {
  async dispatch(job: EmailJob): Promise<void> {
    // Dev/test path. Runs synchronously; no retry budget because the
    // whole point of in-process is fast local feedback. The caller
    // (usually a route's fire-and-forget .catch log) sees the raw error.
    await handleEmailJob(job, 0, 1)
  }
}

export class BullMQEmailDispatcher implements EmailDispatcher {
  private queue: Queue<EmailJob>

  constructor(connectionOrUrl: ReturnType<typeof createRedisConnection> | string) {
    const connection =
      typeof connectionOrUrl === 'string'
        ? createRedisConnection(connectionOrUrl)
        : connectionOrUrl
    const queueOpts: QueueOptions = { connection }
    this.queue = new Queue<EmailJob>(EMAIL_QUEUE_NAME, queueOpts)
  }

  async dispatch(job: EmailJob): Promise<void> {
    await this.queue.add(job.template, job, {
      jobId: jobIdFor(job),
      ...EMAIL_JOB_OPTS,
    })
  }

  async close(): Promise<void> {
    await this.queue.close()
  }
}

let cached: EmailDispatcher | null = null

export function getEmailDispatcher(): EmailDispatcher {
  if (cached) return cached
  const redisUrl = process.env.REDIS_URL
  if (redisUrl && redisUrl.trim() !== '') {
    cached = new BullMQEmailDispatcher(redisUrl)
  } else {
    cached = new InProcessEmailDispatcher()
  }
  return cached
}

// Convenience. Every call site goes through this.
export async function enqueueEmail(job: EmailJob): Promise<void> {
  await getEmailDispatcher().dispatch(job)
}

// Test hook.
export function __resetEmailDispatcher(): void {
  cached = null
}

// Exported for the worker to reuse the jobId hash.
export { jobIdFor as __jobIdForEmail }
