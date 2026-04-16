import crypto from 'crypto'

/**
 * Generate a cryptographically random verification token.
 *
 * Returns:
 *   - `raw`: 64-hex-char string (32 random bytes). This is the value placed in
 *     the URL and sent to the user. It never touches the database.
 *   - `hash`: sha256(raw) as 64 hex chars. This is what the database stores —
 *     so even a DB leak cannot be replayed as active tokens.
 *
 * Used for password reset (URL magic link). Email verification now uses
 * `generateVerificationCode()` (6-digit) instead.
 */
export function generateVerificationToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex')
  const hash = hashToken(raw)
  return { raw, hash }
}

/**
 * Generate a 6-digit numeric verification code.
 *
 * The code lives in the database as `sha256(raw)`, so a DB read can't surface
 * active codes. Because the search space is only 1M, callers MUST cap attempts
 * (we use `EmailVerificationToken.attempts` with a max of 5) and use a short
 * TTL — see `VERIFICATION_CODE_TTL_MINUTES`. Without those guards the code is
 * brute-forceable in seconds.
 *
 * Generated via `crypto.randomInt` for a uniform distribution that cannot be
 * predicted from `Math.random` state.
 */
export function generateVerificationCode(): { raw: string; hash: string } {
  const n = crypto.randomInt(0, 1_000_000)
  const raw = n.toString().padStart(6, '0')
  const hash = hashToken(raw)
  return { raw, hash }
}

/** Deterministic sha256 hex of a raw token (used to look tokens up by hash). */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}
