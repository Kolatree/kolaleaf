import { prisma } from '@/lib/db/client'
import { generateVerificationCode } from './tokens'
import { sendEmail, renderVerificationEmail } from '@/lib/email'

// Short TTL is part of the brute-force defence — the per-token attempt cap
// (5, enforced in verifyEmailWithCode) is the primary control, but a short
// window shrinks the workable attack surface further.
export const VERIFICATION_CODE_TTL_MINUTES = 30
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5

// Limit how often a single user can request a fresh code. Without this, an
// attacker who knows an email could DoS the user's inbox by hammering the
// resend path, OR (worse) keep rotating the code so the user never sees a
// stable one.
const RESEND_RATE_LIMIT_PER_HOUR = 5

export interface IssueOptions {
  userId: string
  email: string
  recipientName: string
}

export interface IssueResult {
  ok: true
}

export interface IssueRateLimited {
  ok: false
  reason: 'rate_limited'
  retryAfterMs: number
}

/**
 * Issue a 6-digit verification code, persist its hash, and email it.
 *
 * Side effects (in order):
 *   1. Marks any outstanding unused tokens for (userId, email) as used. Only
 *      the latest code is ever valid — a user who clicks resend invalidates
 *      the previous one.
 *   2. Inserts a fresh `EmailVerificationToken` with `attempts = 0`.
 *   3. Sends the email via Resend (throws on send failure so callers can
 *      decide whether to surface it; today both register and login swallow
 *      the throw and return success — the user can re-trigger from the
 *      verify-email page).
 *
 * Returns `{ ok: false, reason: 'rate_limited' }` when the user has already
 * requested >= RESEND_RATE_LIMIT_PER_HOUR codes in the last hour. The caller
 * decides how to surface (HTTP 429 for resend, silent for the auto-resend
 * triggered from the login path).
 */
export async function issueVerificationCode(
  opts: IssueOptions,
): Promise<IssueResult | IssueRateLimited> {
  const { userId, email, recipientName } = opts

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recent = await prisma.emailVerificationToken.count({
    where: { userId, createdAt: { gte: oneHourAgo } },
  })
  if (recent >= RESEND_RATE_LIMIT_PER_HOUR) {
    return { ok: false, reason: 'rate_limited', retryAfterMs: 60 * 60 * 1000 }
  }

  await prisma.emailVerificationToken.updateMany({
    where: { userId, email, usedAt: null },
    data: { usedAt: new Date() },
  })

  const { raw, hash } = generateVerificationCode()
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000)

  await prisma.emailVerificationToken.create({
    data: { userId, email, tokenHash: hash, expiresAt, attempts: 0 },
  })

  const { subject, html, text } = renderVerificationEmail({
    recipientName,
    code: raw,
    expiresInMinutes: VERIFICATION_CODE_TTL_MINUTES,
  })

  await sendEmail({ to: email, subject, html, text })

  return { ok: true }
}

export type VerifyOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: 'no_token' | 'expired' | 'used' | 'wrong_code' | 'too_many_attempts' }

/**
 * Verify a 6-digit code submitted by the user against the latest active
 * token for the given email.
 *
 * Failure model:
 *   - `no_token`: never had one, or the latest was already used → restart.
 *   - `expired`: latest token's `expiresAt` is past → restart.
 *   - `used`: a duplicate verify-email POST after success → idempotent
 *     no-op for the caller, but we still report it so callers can detect
 *     replay attempts.
 *   - `wrong_code`: code didn't match. Increments `attempts`. After
 *     VERIFICATION_CODE_MAX_ATTEMPTS the next call returns `too_many_attempts`
 *     and the token is invalidated (`usedAt` set) so the user must restart.
 *   - `too_many_attempts`: cap hit on a previous call. Token is dead.
 *
 * Critically: we look the token up by `(email, NOT used, NOT expired)` and
 * THEN compare hashes — never look up by hash directly, because that would
 * require sending a sha256 of attacker input through findUnique without any
 * surrounding rate-limit check.
 */
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
  if (token.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' }
  }

  // Constant-time-ish comparison: hashing both sides via the same sha256
  // means a wrong code never short-circuits earlier than a right code at
  // the byte-comparison level.
  const candidateHash = (await import('./tokens')).hashToken(code)
  if (candidateHash !== token.tokenHash) {
    const updated = await prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    })
    if (updated.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
      // Burn the token so further guesses can't continue against this one.
      await prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      })
      return { ok: false, reason: 'too_many_attempts' }
    }
    return { ok: false, reason: 'wrong_code' }
  }

  // Success path: mark token used, flip identifier verified, log audit event.
  await prisma.emailVerificationToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  })

  const updated = await prisma.userIdentifier.updateMany({
    where: { userId: token.userId, type: 'EMAIL', identifier: token.email },
    data: { verified: true, verifiedAt: new Date() },
  })

  if (updated.count === 0) {
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
