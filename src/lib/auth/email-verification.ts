import { prisma } from '@/lib/db/client'
import { generateVerificationCode } from './tokens'
import { enqueueEmail } from '@/lib/queue/email-dispatcher'
import {
  EMAIL_CODE_TTL_MINUTES,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_SENDS_PER_HOUR,
} from './constants'
import { evaluateCodeAttempt, isAtAttemptCap } from './email-verification-core'
import type { VerifyCodeReason } from './reasons'

// Re-export the knobs callers previously imported so the constants
// move doesn't break any import sites elsewhere in the repo.
export const VERIFICATION_CODE_TTL_MINUTES = EMAIL_CODE_TTL_MINUTES
export const VERIFICATION_CODE_MAX_ATTEMPTS = EMAIL_CODE_MAX_ATTEMPTS

export interface IssueOptions {
  userId: string
  email: string
  recipientName: string
}

export type IssueResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }

// Issue a 6-digit code for a logged-in user who is adding or
// re-verifying an email identifier (the /api/auth/resend-verification
// and change-email flows). Post-account sibling of
// issuePendingEmailCode — shares the hash + attempt-cap + rate-limit
// policy via email-verification-core and constants.ts.
export async function issueVerificationCode(
  opts: IssueOptions,
): Promise<IssueResult> {
  const { userId, email, recipientName } = opts

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recent = await prisma.emailVerificationToken.count({
    where: { userId, createdAt: { gte: oneHourAgo } },
  })
  if (recent >= EMAIL_CODE_SENDS_PER_HOUR) {
    return { ok: false, reason: 'rate_limited', retryAfterMs: 60 * 60 * 1000 }
  }

  await prisma.emailVerificationToken.updateMany({
    where: { userId, email, usedAt: null },
    data: { usedAt: new Date() },
  })

  const { raw, hash } = generateVerificationCode()
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000)

  await prisma.emailVerificationToken.create({
    data: { userId, email, tokenHash: hash, expiresAt, attempts: 0 },
  })

  // Delivery is async via the email queue. Template rendering runs in
  // the worker (email-dispatcher.handleEmailJob), and transient Resend
  // failures retry on exponential backoff with a FailedEmail sink.
  await enqueueEmail({
    template: 'verification_code',
    toEmail: email,
    recipientName,
    code: raw,
    expiresInMinutes: EMAIL_CODE_TTL_MINUTES,
  })

  return { ok: true }
}

export type VerifyOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: VerifyCodeReason }

// Verify a 6-digit code against the latest EmailVerificationToken for
// a given email. Used by the logged-in change-email flow; the wizard's
// pre-account path lives in pending-email-verification.ts.
//
// Token-attempt semantics:
//   - no_token            → never issued, or already used → restart
//   - expired             → past expiresAt → restart
//   - used                → a duplicate verify-email POST after success
//   - wrong_code          → hash mismatch, attempts increment
//   - too_many_attempts   → cap hit; token is burned via usedAt so
//                           further guesses can't continue against it
export async function verifyEmailWithCode(opts: {
  email: string
  code: string
}): Promise<VerifyOutcome> {
  const { email, code } = opts

  const token = await prisma.emailVerificationToken.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
  })

  if (!token) return { ok: false, reason: 'no_token' }
  if (token.usedAt !== null) return { ok: false, reason: 'used' }
  if (token.expiresAt < new Date()) return { ok: false, reason: 'expired' }
  if (isAtAttemptCap(token.attempts)) return { ok: false, reason: 'too_many_attempts' }

  const { match, willHitCap } = evaluateCodeAttempt({
    attempts: token.attempts,
    candidate: code,
    storedHash: token.tokenHash,
  })

  if (!match) {
    const updated = await prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    })
    if (willHitCap || updated.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      })
      return { ok: false, reason: 'too_many_attempts' }
    }
    return { ok: false, reason: 'wrong_code' }
  }

  await prisma.emailVerificationToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  })

  const identifierUpdated = await prisma.userIdentifier.updateMany({
    where: { userId: token.userId, type: 'EMAIL', identifier: token.email },
    data: { verified: true, verifiedAt: new Date() },
  })

  if (identifierUpdated.count === 0) {
    // Identifier was deleted between issue and verify. Don't grant a session.
    return { ok: false, reason: 'no_token' }
  }

  await prisma.authEvent.create({
    data: {
      userId: token.userId,
      event: 'EMAIL_VERIFIED',
      metadata: { identifier: token.email, via: 'verify-email-code' },
    },
  })

  return { ok: true, userId: token.userId }
}
