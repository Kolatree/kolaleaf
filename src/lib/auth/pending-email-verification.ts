import { prisma } from '@/lib/db/client'
import { generateVerificationCode } from './tokens'
import { enqueueEmail } from '@/lib/queue/email-dispatcher'
import {
  EMAIL_CODE_TTL_MINUTES,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CLAIM_WINDOW_MINUTES,
  EMAIL_CODE_SENDS_PER_HOUR,
} from './constants'
import { evaluateCodeAttempt, isAtAttemptCap } from './email-verification-core'
import type { VerifyCodeReason } from './reasons'

// Re-export the knobs callers previously imported from here so we
// don't break /api/auth/send-code and friends with the constants move.
export const PENDING_CODE_TTL_MINUTES = EMAIL_CODE_TTL_MINUTES
export const PENDING_CODE_MAX_ATTEMPTS = EMAIL_CODE_MAX_ATTEMPTS
export const PENDING_CLAIM_WINDOW_MINUTES = EMAIL_CLAIM_WINDOW_MINUTES

export interface IssuePendingOptions {
  email: string
}

export type IssuePendingResult =
  | { ok: true; delivered: boolean }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  | { ok: false; reason: 'claim_in_flight' }
  | { ok: false; reason: 'send_failed'; providerError: string }

// Issue a 6-digit code for the PendingEmailVerification row keyed by
// email. Unlike the post-account path (email-verification.ts), no User
// exists yet — the whole point of this flow is to avoid persisting a
// User row for an unverified address. Rate-limited to
// EMAIL_CODE_SENDS_PER_HOUR per email; resend does NOT invalidate a
// live verified claim (claim preservation).
export async function issuePendingEmailCode(
  opts: IssuePendingOptions,
): Promise<IssuePendingResult> {
  const { email } = opts
  const now = new Date()
  const windowMs = 60 * 60 * 1000
  const windowOpenedAt = new Date(now.getTime() - windowMs)

  const existing = await prisma.pendingEmailVerification.findUnique({
    where: { email },
  })

  let nextSendCount: number
  let nextWindowStart: Date

  if (existing && existing.sendWindowStart > windowOpenedAt) {
    if (existing.sendCount >= EMAIL_CODE_SENDS_PER_HOUR) {
      const retryAfterMs =
        existing.sendWindowStart.getTime() + windowMs - now.getTime()
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: Math.max(retryAfterMs, 0),
      }
    }
    nextSendCount = existing.sendCount + 1
    nextWindowStart = existing.sendWindowStart
  } else {
    nextSendCount = 1
    nextWindowStart = now
  }

  // Claim preservation: if a legitimate user has completed step 2 and
  // is sitting at step 3 with a live claim, a resend MUST NOT wipe
  // that claim — otherwise anyone who knows the email can DoS the
  // wizard by hitting /send-code.
  if (
    existing &&
    existing.verifiedAt !== null &&
    existing.claimExpiresAt !== null &&
    existing.claimExpiresAt > now
  ) {
    return { ok: false, reason: 'claim_in_flight' }
  }

  const { raw, hash } = generateVerificationCode()
  const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MINUTES * 60 * 1000)

  await prisma.pendingEmailVerification.upsert({
    where: { email },
    create: {
      email,
      codeHash: hash,
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
      sendCount: nextSendCount,
      sendWindowStart: nextWindowStart,
    },
    update: {
      codeHash: hash,
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
      sendCount: nextSendCount,
      sendWindowStart: nextWindowStart,
    },
  })

  // No User row yet → "there" as the greeting keeps the subject and
  // body neutral without leaking user-supplied input. Rendering now
  // happens inside the worker (see email-dispatcher handleEmailJob)
  // so any template change is picked up without re-enqueuing.
  //
  // Delivery is async; the queue owns retries + the FailedEmail sink.
  // Only a failure to ENQUEUE (Redis unreachable, crash mid-add)
  // surfaces as send_failed here.
  try {
    await enqueueEmail({
      template: 'verification_code',
      toEmail: email,
      recipientName: 'there',
      code: raw,
      expiresInMinutes: EMAIL_CODE_TTL_MINUTES,
    })
  } catch (err) {
    return {
      ok: false,
      reason: 'send_failed',
      providerError: err instanceof Error ? err.message : 'Enqueue failed',
    }
  }

  return { ok: true, delivered: true }
}

export type VerifyPendingOutcome =
  | { ok: true }
  | { ok: false; reason: VerifyCodeReason }

// Verify a 6-digit code for a PendingEmailVerification row.
//
// On success: flip verifiedAt + claimExpiresAt so step 3 has a
// bounded window. The row is NOT deleted here —
// /complete-registration consumes it.
//
// On duplicate success inside the claim window: idempotent ok (a user
// may re-submit verify after a back-button reload).
//
// On Nth wrong attempt: single atomic update that both increments
// `attempts` and burns the token via `expiresAt` in the past, so
// there's no intermediate state where attempts has landed but the
// row is still guessable.
export async function verifyPendingEmailCode(opts: {
  email: string
  code: string
}): Promise<VerifyPendingOutcome> {
  const { email, code } = opts

  const row = await prisma.pendingEmailVerification.findUnique({ where: { email } })
  if (!row) return { ok: false, reason: 'no_token' }

  const now = new Date()

  if (row.verifiedAt !== null) {
    if (row.claimExpiresAt && row.claimExpiresAt > now) return { ok: true }
    return { ok: false, reason: 'used' }
  }
  if (row.expiresAt < now) return { ok: false, reason: 'expired' }
  if (isAtAttemptCap(row.attempts)) return { ok: false, reason: 'too_many_attempts' }

  const { match, willHitCap } = evaluateCodeAttempt({
    attempts: row.attempts,
    candidate: code,
    storedHash: row.codeHash,
  })

  if (!match) {
    await prisma.pendingEmailVerification.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        ...(willHitCap ? { expiresAt: new Date(now.getTime() - 1) } : {}),
      },
    })
    return {
      ok: false,
      reason: willHitCap ? 'too_many_attempts' : 'wrong_code',
    }
  }

  await prisma.pendingEmailVerification.update({
    where: { id: row.id },
    data: {
      verifiedAt: now,
      claimExpiresAt: new Date(now.getTime() + EMAIL_CLAIM_WINDOW_MINUTES * 60 * 1000),
    },
  })

  return { ok: true }
}
