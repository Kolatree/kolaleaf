import { hashToken } from './tokens'
import { EMAIL_CODE_MAX_ATTEMPTS } from './constants'

// Shared primitives between the pre-account (PendingEmailVerification)
// and post-account (EmailVerificationToken) email-code flows. The
// verify-outcome enum, the hash comparison, and the "compute next
// attempt state" math are identical across both — factoring them out
// avoids asymmetry drift when we tune policy.

export interface CodeAttemptPolicy {
  /** Current attempts on the token before this verify call. */
  attempts: number
  /** The code the user just submitted (raw 6 digits). */
  candidate: string
  /** The hash stored on the token. */
  storedHash: string
}

export interface CodeAttemptResult {
  match: boolean
  willHitCap: boolean
}

// Evaluate a submitted code against a stored hash under the fixed
// PENDING/TOKEN attempt cap. Callers use this to decide whether to
// return ok / wrong_code / too_many_attempts and whether to burn the
// token in the same update.
//
// Constant-time-ish: we always hash the candidate (not an early-return
// on length/format mismatch), so timing never reveals whether the
// stored hash was checked.
export function evaluateCodeAttempt(p: CodeAttemptPolicy): CodeAttemptResult {
  const candidateHash = hashToken(p.candidate)
  const match = candidateHash === p.storedHash
  const willHitCap = !match && p.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS
  return { match, willHitCap }
}

// Decide whether the row is at-cap BEFORE incrementing. Used by the
// pre-hash guard in both verify paths so attackers can't pump extra
// attempts through a burned token.
export function isAtAttemptCap(attempts: number): boolean {
  return attempts >= EMAIL_CODE_MAX_ATTEMPTS
}
