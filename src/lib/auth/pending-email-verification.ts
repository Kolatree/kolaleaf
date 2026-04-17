import { prisma } from '@/lib/db/client'
import { generateVerificationCode, hashToken } from './tokens'
import { sendEmail, renderVerificationEmail } from '@/lib/email'

// Parallel of EmailVerificationToken's constants, tuned for the wizard.
// TTL is 30 min (matches the existing email code) and the claim window is
// also 30 min — ample time for the user to fill the details step without
// being so long that a verified-but-abandoned row lingers usefully.
export const PENDING_CODE_TTL_MINUTES = 30
export const PENDING_CODE_MAX_ATTEMPTS = 5
export const PENDING_CLAIM_WINDOW_MINUTES = 30

// 5 sends per email per hour. Same cap as the logged-in verification path —
// keeps DoS-by-resend out of the picture and bounds the code-rotation
// surface an attacker could use to race a code that's still in a user's
// inbox.
const SEND_RATE_LIMIT_PER_HOUR = 5

export interface IssuePendingOptions {
  email: string
}

export type IssuePendingResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }

/**
 * Issue a 6-digit code for the `PendingEmailVerification` row keyed by
 * email. Unlike `issueVerificationCode` (for logged-in users), no User
 * exists when this runs — the whole point of this flow is to avoid
 * persisting a User row for an unverified email.
 *
 * Side effects:
 *   1. Upserts a row for `email`: attempts=0, fresh codeHash,
 *      expiresAt = now + TTL, verifiedAt and claimExpiresAt cleared so a
 *      resend always restarts the verification clock.
 *   2. Sends the code via Resend.
 *
 * Rate-limited at 5 issues per email per hour.
 */
export async function issuePendingEmailCode(
  opts: IssuePendingOptions,
): Promise<IssuePendingResult> {
  const { email } = opts

  const now = new Date()
  const windowMs = 60 * 60 * 1000
  const windowOpenedAt = new Date(now.getTime() - windowMs)

  // Rate-limit counter. The previous design (count rows created in the
  // last hour) could never reach the cap because the table is upsert-
  // keyed by email — one row per address, `createdAt` fixed at first
  // insert. We now read `sendCount` + `sendWindowStart` off the row and
  // branch explicitly: inside-window → check cap, then increment;
  // outside-window → reset to 1 and start a new window.
  const existing = await prisma.pendingEmailVerification.findUnique({
    where: { email },
  })

  let nextSendCount: number
  let nextWindowStart: Date

  if (existing && existing.sendWindowStart > windowOpenedAt) {
    // Inside the active window.
    if (existing.sendCount >= SEND_RATE_LIMIT_PER_HOUR) {
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
    // No row yet, or the previous window has closed. Start fresh.
    nextSendCount = 1
    nextWindowStart = now
  }

  const { raw, hash } = generateVerificationCode()
  const expiresAt = new Date(now.getTime() + PENDING_CODE_TTL_MINUTES * 60 * 1000)

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

  // No User row yet, so we can't greet by name. "there" keeps the copy
  // warm without leaking any user-supplied string back into the subject
  // line or body.
  const { subject, html, text } = renderVerificationEmail({
    recipientName: 'there',
    code: raw,
    expiresInMinutes: PENDING_CODE_TTL_MINUTES,
  })

  await sendEmail({ to: email, subject, html, text })

  return { ok: true }
}

export type VerifyPendingOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'no_token' | 'expired' | 'used' | 'wrong_code' | 'too_many_attempts'
    }

/**
 * Verify a 6-digit code for a PendingEmailVerification row.
 *
 * Failure model mirrors verifyEmailWithCode so routes and UIs can share
 * the same error-to-copy mapping:
 *   - `no_token`       never issued for this email, or already deleted
 *   - `expired`        past expiresAt and not yet verified
 *   - `used`           already verified AND claim window has closed
 *   - `too_many_attempts` attempts ≥ cap (also returned after the Nth wrong)
 *   - `wrong_code`     mismatch before the cap
 *
 * On success: set verifiedAt=now, claimExpiresAt=now+claim window. The row
 * is NOT deleted here — /complete-registration consumes it in one tx.
 *
 * If the caller re-submits inside the claim window after a success, we
 * return ok:true again (idempotent) rather than `used`, because step 3
 * may legitimately fire step 2 again (e.g. back-button reload).
 */
export async function verifyPendingEmailCode(opts: {
  email: string
  code: string
}): Promise<VerifyPendingOutcome> {
  const { email, code } = opts

  const row = await prisma.pendingEmailVerification.findUnique({
    where: { email },
  })

  if (!row) return { ok: false, reason: 'no_token' }

  const now = new Date()

  // If already verified AND still inside the claim window, a duplicate
  // verify is a no-op success — see JSDoc.
  if (row.verifiedAt !== null) {
    if (row.claimExpiresAt && row.claimExpiresAt > now) return { ok: true }
    return { ok: false, reason: 'used' }
  }

  if (row.expiresAt < now) return { ok: false, reason: 'expired' }

  if (row.attempts >= PENDING_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' }
  }

  const candidateHash = hashToken(code)
  if (candidateHash !== row.codeHash) {
    // Decide up-front whether this attempt hits the cap, then issue a
    // SINGLE atomic update. Previously we did an increment followed by a
    // conditional burn — two writes, fragile. With one write there is no
    // window in which `attempts` has landed but `expiresAt` has not.
    //
    // No `usedAt` on this model — burn by expiring the row in the past so
    // a subsequent attempt hits the `expired` branch. The row stays
    // findable by email, so a user clicking "resend" cleanly upserts a
    // fresh code over the top.
    const willHitCap = row.attempts + 1 >= PENDING_CODE_MAX_ATTEMPTS
    await prisma.pendingEmailVerification.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        ...(willHitCap ? { expiresAt: new Date(now.getTime() - 1) } : {}),
      },
    })
    if (willHitCap) return { ok: false, reason: 'too_many_attempts' }
    return { ok: false, reason: 'wrong_code' }
  }

  await prisma.pendingEmailVerification.update({
    where: { id: row.id },
    data: {
      verifiedAt: now,
      claimExpiresAt: new Date(now.getTime() + PENDING_CLAIM_WINDOW_MINUTES * 60 * 1000),
    },
  })

  return { ok: true }
}
