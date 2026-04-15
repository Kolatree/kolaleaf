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
 * Reusable for email verification and password reset.
 */
export function generateVerificationToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex')
  const hash = hashToken(raw)
  return { raw, hash }
}

/** Deterministic sha256 hex of a raw token (used to look tokens up by hash). */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}
