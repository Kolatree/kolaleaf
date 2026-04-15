import bcrypt from 'bcrypt'

const COST_FACTOR = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Password complexity rules shared by /register and /reset-password.
 *
 * Bar appropriate for an AUSTRAC-registered money transmitter:
 *   - Minimum length: 12 characters
 *   - Must contain at least 3 of: lowercase, uppercase, digit, special char
 *
 * Intentionally omitted (deferred):
 *   - Breach-dictionary check (HaveIBeenPwned or offline list) — needs an
 *     external dependency. Track for a later hardening step.
 *
 * Error messages name the specific rule so the UI (15g+) can surface useful
 * feedback instead of a generic "password too weak".
 */
export const MIN_PASSWORD_LENGTH = 12
export const MIN_CHARACTER_CLASSES = 3

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; error: string; rule: 'missing' | 'length' | 'complexity' }

export function validatePasswordComplexity(plain: unknown): PasswordValidationResult {
  if (typeof plain !== 'string' || plain.length === 0) {
    return { ok: false, error: 'Password is required', rule: 'missing' }
  }
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      rule: 'length',
    }
  }
  const classes =
    Number(/[a-z]/.test(plain)) +
    Number(/[A-Z]/.test(plain)) +
    Number(/[0-9]/.test(plain)) +
    Number(/[^A-Za-z0-9]/.test(plain))
  if (classes < MIN_CHARACTER_CLASSES) {
    return {
      ok: false,
      error: `Password must contain at least ${MIN_CHARACTER_CLASSES} of: lowercase letter, uppercase letter, digit, special character`,
      rule: 'complexity',
    }
  }
  return { ok: true }
}
