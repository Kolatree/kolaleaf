import bcrypt from 'bcrypt'
import crypto from 'crypto'

/**
 * Thrown by `normalizePhone` when the input cannot be coerced to E.164.
 * Route handlers should catch this and return a 400 with a safe message.
 */
export class InvalidPhoneError extends Error {
  constructor(message = 'Invalid phone number') {
    super(message)
    this.name = 'InvalidPhoneError'
  }
}

/**
 * Normalise a user-supplied phone number to E.164.
 *
 * NOTE: This is a placeholder regex-only implementation. It strips spaces,
 * dashes, and parens, then requires the result to be `+` followed by 7-15
 * digits (per ITU-T E.164). It does NOT validate country codes, carrier
 * prefixes, or regional formats — a `+10000000` would pass this check even
 * though no country uses that prefix.
 *
 * Replacement path: swap in `libphonenumber-js` (or Twilio Lookup for
 * server-side validation) when we bring in a proper dep. Tracked in
 * BUILD-LOG Known Gaps for step 15e.
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new InvalidPhoneError('Phone number required')
  }
  const stripped = raw.replace(/[\s\-()]/g, '')
  if (!/^\+\d{7,15}$/.test(stripped)) {
    throw new InvalidPhoneError('Phone must be E.164 format (e.g. +61400000000)')
  }
  return stripped
}

/**
 * Generate a 6-digit zero-padded SMS code and its bcrypt hash.
 *
 * We deliberately use bcrypt at cost 4 — NOT sha256 — because the code space
 * is only 10^6. With sha256 a leaked DB table would be trivially rainbow-
 * tabled (brute-forcing 1M values is a sub-second operation). bcrypt's salt
 * + work factor blocks that. Cost 4 is intentional: codes are valid for 5-10
 * minutes, so we want verify to be fast, and the work factor only needs to
 * outpace a brute-force of the full 6-digit space before expiry.
 */
export function generateSmsCode(): { code: string; hash: string } {
  const n = crypto.randomInt(0, 1_000_000)
  const code = n.toString().padStart(6, '0')
  const hash = bcrypt.hashSync(code, 4)
  return { code, hash }
}

/** bcrypt-compare a raw SMS code against the stored hash. */
export async function verifySmsCode(rawCode: string, hash: string): Promise<boolean> {
  return bcrypt.compare(rawCode, hash)
}
